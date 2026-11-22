/**
 * What the CLI and the MCP server both do: sign payment terms, ask the Nod server whether they
 * were paid (NodReceipts on HSK Chain, via GET /api/receipt), and list what this agent asked for.
 */
import { buildTermsUrl, createTerms, hashTerms, isExpired, type NodTerms } from '@nod/protocol';
import type { Hex } from 'viem';
import { nodAgentName, nodBaseUrl, type Env } from './config.js';
import { loadAgentKey } from './keys.js';
import { addRequest, findRequest, markPaid, readStore, type StoredRequest } from './store.js';

/** Terms stay valid this long unless --expires says otherwise. */
export const DEFAULT_EXPIRES_IN_SEC = 60 * 60;

const UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/** "90s", "30m", "1h", "2d" or a bare number of seconds → seconds (60 s to 30 days). */
export const parseDuration = (text: string): number => {
  const m = /^\s*(\d+)\s*([smhd]?)\s*$/i.exec(text);
  if (!m) throw new Error(`Invalid duration "${text}" (use e.g. 90s, 30m, 1h, 2d)`);
  const seconds = Number(m[1]) * UNITS[(m[2] || 's').toLowerCase()]!;
  if (seconds < 60) throw new Error('Expiry must be at least 60 seconds');
  if (seconds > 30 * 86400) throw new Error('Expiry must be at most 30 days');
  return seconds;
};

/** "$0.10", ".5" and 0.1 become "0.10"-style strings the terms accept; anything else is left for validation. */
export const normalizeUsd = (value: string | number): string => {
  let text = typeof value === 'number' ? String(value) : value.trim();
  text = text.replace(/^\$\s*/, '').replace(/\s*(usd)$/i, '');
  if (text.startsWith('.')) text = `0${text}`;
  return text;
};

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface CreateOptions {
  /** Recipient address (lowercase or EIP-55 checksummed). */
  payTo: string;
  /** USD amount, e.g. "0.10" (at most 2 decimals). */
  amountUsd: string | number;
  purpose: string;
  /** Name shown to the payer (default NOD_AGENT_NAME, else "Nod agent"). */
  merchant?: string;
  /** Seconds until expiry (default 1 hour). */
  expiresIn?: number;
  /** App origin for the link (default NOD_BASE_URL). */
  baseUrl?: string;
  env?: Env;
}

/** Sign terms with the agent key, store them locally and return the record with its approval link. */
export const createPaymentRequest = async (opts: CreateOptions): Promise<StoredRequest> => {
  const env = opts.env ?? process.env;
  const key = loadAgentKey(env);
  if (key.source === 'created') {
    process.stderr.write(`nod: created a new agent key at ${key.path} (address ${key.address})\n`);
  }
  const signed = await createTerms(
    {
      merchant: (opts.merchant ?? nodAgentName(env)).trim(),
      payTo: opts.payTo.trim(),
      amountUsd: normalizeUsd(opts.amountUsd),
      purpose: opts.purpose.trim(),
      expiresInSec: opts.expiresIn ?? DEFAULT_EXPIRES_IN_SEC,
    },
    key.account,
  );
  const record: StoredRequest = {
    id: signed.terms.id,
    termsHash: hashTerms(signed.terms),
    link: buildTermsUrl(opts.baseUrl ?? nodBaseUrl(env), signed),
    createdAt: Date.now(),
    signed,
  };
  addRequest(record, env);
  return record;
};

/** A NodReceipts receipt as the Nod server returns it. */
export interface ReceiptInfo {
  settlementTx: Hex;
  chainId: number;
  payer: string;
  payTo: string;
  amount: string;
  anchoredAt: number;
  settlementExplorerUrl?: string;
}

export interface StatusResult {
  termsHash: Hex;
  /** Terms id, when the terms are in the local store. */
  id?: Hex;
  /**
   * paid: anchored in NodReceipts by the server's recorder. unpaid: not yet. expired: not paid
   * and past the expiry. unknown: the server has no NodReceipts contract configured.
   */
  status: 'paid' | 'unpaid' | 'expired' | 'unknown';
  receipt?: ReceiptInfo;
  /** Explorer page of the settlement transaction. */
  settlementUrl?: string;
  recorder?: string | null;
  contract?: string | null;
  /** Approval link, when the terms are in the local store. */
  link?: string;
  note?: string;
}

export interface StatusOptions {
  env?: Env;
  /** fetch to use (tests); default the global fetch. */
  fetch?: typeof fetch;
  /** Nod server origin (default NOD_BASE_URL). */
  baseUrl?: string;
  timeoutMs?: number;
}

interface ReceiptBody {
  anchored?: unknown;
  receipt?: ReceiptInfo;
  recorder?: string | null;
  contract?: string | null;
  explorer?: { settlementTx?: string };
  reason?: string;
  error?: string;
}

/**
 * Ask the Nod server (GET {NOD_BASE_URL}/api/receipt) whether these terms were paid. Accepts a
 * stored id or termsHash (or a unique prefix of either), or any full termsHash.
 */
export const checkStatus = async (target: string, opts: StatusOptions = {}): Promise<StatusResult> => {
  const env = opts.env ?? process.env;
  const record = findRequest(target, env);
  let termsHash: Hex;
  if (record) termsHash = record.termsHash;
  else if (/^0x[0-9a-fA-F]{64}$/.test(target.trim())) termsHash = target.trim().toLowerCase() as Hex;
  else throw new Error(`No terms "${target}" in the local store (see "list"); pass a full termsHash to look up any terms`);

  const base = (opts.baseUrl ?? nodBaseUrl(env)).replace(/\/+$/, '');
  const url = `${base}/api/receipt?termsHash=${termsHash}`;
  let res: Response;
  try {
    res = await (opts.fetch ?? fetch)(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000) });
  } catch (e) {
    throw new Error(`Could not reach the Nod server at ${base} (${message(e)}); set NOD_BASE_URL to the Nod app`);
  }
  let body: ReceiptBody;
  try {
    body = (await res.json()) as ReceiptBody;
  } catch {
    throw new Error(`${url} did not answer with JSON (HTTP ${res.status}); is NOD_BASE_URL the Nod app?`);
  }
  if (!res.ok) throw new Error(`The Nod server answered ${res.status}: ${body.error ?? 'error'}`);

  const result: StatusResult = {
    termsHash,
    status: 'unpaid',
    ...(record ? { id: record.id, link: record.link } : {}),
    recorder: body.recorder ?? null,
    contract: body.contract ?? null,
  };
  if (body.anchored === true && body.receipt) {
    if (record) markPaid(termsHash, { settlementTx: body.receipt.settlementTx, chainId: body.receipt.chainId }, env);
    const settlementUrl = body.explorer?.settlementTx ?? body.receipt.settlementExplorerUrl;
    return { ...result, status: 'paid', receipt: body.receipt, ...(settlementUrl ? { settlementUrl } : {}) };
  }
  if (!body.contract) {
    return { ...result, status: 'unknown', note: body.reason ?? 'The Nod server has no NodReceipts contract configured' };
  }
  return { ...result, status: record && isExpired(record.signed.terms) ? 'expired' : 'unpaid' };
};

export interface ListedRequest {
  id: Hex;
  termsHash: Hex;
  merchant: string;
  payTo: string;
  amountUsd: string;
  purpose: string;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
  /** Settlement transaction, once a status check found the receipt. */
  paid?: Hex;
  link: string;
}

/** Terms this agent created, newest first. */
export const listRequests = (env: Env = process.env): ListedRequest[] =>
  readStore(env)
    .map((r) => {
      const t: NodTerms = r.signed.terms;
      return {
        id: r.id,
        termsHash: r.termsHash,
        merchant: t.merchant,
        payTo: t.payTo,
        amountUsd: t.amountUsd,
        purpose: t.purpose,
        createdAt: new Date(r.createdAt).toISOString(),
        expiresAt: new Date(t.expiry * 1000).toISOString(),
        expired: isExpired(t),
        ...(r.paid ? { paid: r.paid.settlementTx } : {}),
        link: r.link,
      };
    })
    .reverse();
