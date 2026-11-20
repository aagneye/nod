/**
 * What the CLI and the MCP server both do: create a signed request, check whether it was paid, list.
 */
import {
  CASHADDR_PREFIX,
  EXPLORER_TX_URL,
  MAX_PURPOSE_LENGTH,
  NodElectrum,
  buildRequestUrl,
  createRequest,
  findPayment,
  hashRequest,
  isExpired,
  toHex,
  verifyReceipt,
  type ChainReader,
  type Network,
} from '@nod/protocol';
import { nodAgentName, nodBaseUrl, nodNetwork } from './config.js';
import { loadAgentKey } from './keys.js';
import { addRequest, findRequest, markPaid, readStore, type StoredRequest } from './store.js';

const UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/** "90s", "30m", "1h", "2d" or a bare number of seconds → seconds. */
export const parseDuration = (text: string): number => {
  const m = /^\s*(\d+)\s*([smhd]?)\s*$/i.exec(text);
  if (!m) throw new Error(`Invalid duration "${text}" (use e.g. 90s, 30m, 1h, 2d)`);
  const seconds = Number(m[1]) * UNITS[(m[2] || 's').toLowerCase()]!;
  if (seconds < 60) throw new Error('Expiry must be at least 60 seconds');
  if (seconds > 30 * 86400) throw new Error('Expiry must be at most 30 days');
  return seconds;
};

export interface CreateOptions {
  vendor: string;
  sats: number;
  purpose: string;
  /** Seconds until expiry (default 3600). */
  expiresIn?: number;
  agentName?: string;
  baseUrl?: string;
  buyer?: string;
  env?: NodeJS.ProcessEnv;
  /** For tests. Unix seconds. */
  now?: number;
}

export const createPaymentRequest = (opts: CreateOptions): StoredRequest => {
  const env = opts.env ?? process.env;
  const network = nodNetwork(env);
  const vendor = opts.vendor.trim().toLowerCase();
  const prefix = CASHADDR_PREFIX[network];
  if (!vendor.startsWith(`${prefix}:`)) {
    throw new Error(`Vendor must be a ${network} address starting with "${prefix}:" (set NOD_NETWORK to change network)`);
  }
  if (!Number.isSafeInteger(opts.sats) || opts.sats <= 0) throw new Error('sats must be a positive integer');
  const purpose = opts.purpose.trim();
  if (purpose.length === 0 || purpose.length > MAX_PURPOSE_LENGTH) {
    throw new Error(`purpose must be 1-${MAX_PURPOSE_LENGTH} characters`);
  }
  const key = loadAgentKey(env);
  if (key.source === 'created') {
    process.stderr.write(`nod: created a new agent key at ${key.path} (pubkey ${key.publicKey})\n`);
  }
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const signed = createRequest(
    {
      agentName: (opts.agentName ?? nodAgentName(env)).slice(0, 64),
      vendor,
      amount: { sats: opts.sats },
      purpose,
      expiry: now + (opts.expiresIn ?? 3600),
      ...(opts.buyer ? { buyer: opts.buyer.trim().toLowerCase() } : {}),
    },
    key.privateKey,
  );
  const record: StoredRequest = {
    id: signed.req.id,
    hash: toHex(hashRequest(signed.req)),
    link: buildRequestUrl(opts.baseUrl ?? nodBaseUrl(env), signed),
    network,
    createdAt: Date.now(),
    signed,
  };
  addRequest(record, env);
  return record;
};

export interface StatusResult {
  id: string;
  hash: string;
  network: Network;
  status: 'paid' | 'unpaid' | 'expired';
  txid?: string;
  explorerUrl?: string;
  /** Present when a candidate tx was found but failed the full receipt check. */
  reasons?: string[];
  link: string;
}

export interface StatusOptions {
  env?: NodeJS.ProcessEnv;
  /** Inject a chain reader (tests); otherwise a NodElectrum for the request's network. */
  chain?: ChainReader;
  maxTxs?: number;
}

export const checkStatus = async (idOrHash: string, opts: StatusOptions = {}): Promise<StatusResult> => {
  const env = opts.env ?? process.env;
  const record = findRequest(idOrHash, env);
  if (!record) throw new Error(`No request "${idOrHash}" in the local store (see "list")`);
  const req = record.signed.req;
  const hash = hashRequest(req);
  const own = opts.chain ? null : new NodElectrum(record.network);
  const chain = opts.chain ?? own!;
  const base = { id: record.id, hash: record.hash, network: record.network, link: record.link };
  try {
    const found = await findPayment(chain, req, hash, { maxTxs: opts.maxTxs ?? 100 });
    if (!found) return { ...base, status: isExpired(req) ? 'expired' : 'unpaid' };
    const check = await verifyReceipt(chain, found.txid, req, hash);
    const explorerUrl = `${EXPLORER_TX_URL[record.network]}${found.txid}`;
    if (!check.ok) return { ...base, status: 'unpaid', txid: found.txid, explorerUrl, reasons: check.reasons };
    markPaid(record.id, found.txid, env);
    return { ...base, status: 'paid', txid: found.txid, explorerUrl };
  } finally {
    if (own) await own.disconnect().catch(() => undefined);
  }
};

export interface ListedRequest {
  id: string;
  hash: string;
  network: Network;
  vendor: string;
  sats: number | null;
  purpose: string;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
  paidTxid?: string;
  link: string;
}

export const listRequests = (env: NodeJS.ProcessEnv = process.env): ListedRequest[] =>
  readStore(env)
    .map((r) => {
      const req = r.signed.req;
      return {
        id: r.id,
        hash: r.hash,
        network: r.network,
        vendor: req.vendor,
        sats: 'sats' in req.amount ? req.amount.sats : null,
        purpose: req.purpose,
        createdAt: new Date(r.createdAt).toISOString(),
        expiresAt: new Date(req.expiry * 1000).toISOString(),
        expired: isExpired(req),
        ...(r.paidTxid ? { paidTxid: r.paidTxid } : {}),
        link: r.link,
      };
    })
    .reverse();
