/**
 * Typed client for the Nod server (JSON; errors are `{ error, code? }`).
 * The server talks to HSP and HSK Chain; the browser only ever talks to it and to the wallet.
 */
import type { SignedTerms } from '@nod/protocol';
import { API_BASE } from '../config';

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

/** The token and network HSP settles in (from HSP's get_chain_config). */
export interface PaymentOption {
  network: string;
  chainId: number;
  contractAddress: string;
  coin: string;
  decimals: number;
  paymentProtocol: string;
}

export interface NodConfig {
  receipts: { chainId: number; address: string | null; recorder: string | null; explorer?: string | null };
  policy: { chainId: number; address: string | null };
  hsp: {
    mode: 'live' | 'mock';
    /** The team's HSP reporting name; null when unset. */
    merchantName: string | null;
    reachable: boolean;
    error?: string;
    option?: PaymentOption;
  };
  demoUsd: string | number;
}

export interface DemoAgentResponse {
  /** `<app>/r#<payload>` */
  link: string;
  signed: SignedTerms;
  termsHash: string;
  /** e.g. an ephemeral agent key on the server. */
  warning?: string;
}

/** EIP-712 typed data exactly as HSP's prepare_payment returned it. */
export interface TypedDataPayload {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface PayStartResponse {
  flowId: string;
  paymentRequestId: string;
  termsHash: string;
  payTo: string;
  payer: string;
  eip712: TypedDataPayload;
  /** Token base units, as a decimal string. */
  tokenTotalRaw: string;
  /** Unix seconds (null when HSP did not say); read with toUnixSeconds. */
  quoteExpiresAt?: number | string | null;
  option: PaymentOption;
  /** Handed back unchanged to /api/pay/finish. */
  opaque: unknown;
}

export interface PayFinishResponse {
  status: string;
  flowId: string;
  paymentRequestId: string;
}

export type PayOutcome = 'pending' | 'paid' | 'failed';

export interface PayStatusResponse {
  status: string;
  outcome: PayOutcome;
  txHash?: string;
  chainId?: number;
  network?: string;
  payer?: string;
  payTo?: string;
  attributionVerified?: boolean;
  statusReason?: string;
  explorerUrl?: string;
}

export type AnchorResult =
  /** `pending`: broadcast, but not mined within the server's wait. */
  | { txHash: string; explorerUrl?: string; pending?: boolean }
  | { already: true; receipt?: unknown }
  /** `failed`: the anchor transaction was attempted and failed. */
  | { skipped: true; reason?: string; failed?: boolean };

export interface SettlementCheck {
  ok: boolean;
  reasons: string[];
  /** Token base units of the matching Transfer. */
  transferredRaw?: string;
  /** Nothing was checked on chain (simulation mode). */
  skipped?: boolean;
  reason?: string;
}

export interface SettleResponse {
  ok: boolean;
  check: SettlementCheck;
  anchor: AnchorResult;
}

export interface ReceiptLookup {
  anchored: boolean;
  termsHash?: string;
  /** Chain of the NodReceipts contract. */
  chainId?: number;
  receipt?: unknown;
  recorder?: string | null;
  contract?: string | null;
  explorer?: { contract?: string; recorder?: string; settlementTx?: string };
  /** Why nothing could be looked up (e.g. contract not configured). */
  reason?: string;
}

export interface DeliveredItem {
  title: string;
  body: string;
  /** Unix seconds or milliseconds, or an ISO date. */
  deliveredAt: number | string;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

/** A failed API call: HTTP status (0 when the server was unreachable), the server's `code`, and the body. */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly body: Json | null;

  constructor(message: string, status: number, code?: string, body: Json | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

async function call<T>(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const hasBody = init.body !== undefined;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: init.method ?? 'GET',
      headers: hasBody ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
      body: hasBody ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
      signal: init.signal,
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ApiError('Could not reach the Nod server. Check your connection and try again.', 0, 'network');
  }
  let data: Json | null = null;
  try {
    const parsed: unknown = await res.json();
    data = isRecord(parsed) ? parsed : null;
  } catch {
    /* not JSON, e.g. the app's own index.html when no API is deployed at this address */
  }
  if (!res.ok) {
    const message =
      typeof data?.error === 'string' && data.error.trim() ? data.error : `The Nod server answered ${res.status}.`;
    throw new ApiError(message, res.status, typeof data?.code === 'string' ? data.code : undefined, data);
  }
  if (!data) {
    throw new ApiError(
      'The Nod API is not available at this address (the server did not answer with JSON).',
      res.status,
      'bad_response',
    );
  }
  return data as T;
}

const post = <T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> =>
  call<T>(path, { method: 'POST', body, signal });

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const getConfig = (signal?: AbortSignal): Promise<NodConfig> => call<NodConfig>('/api/config', { signal });

export const getDemoAgent = (): Promise<DemoAgentResponse> => call<DemoAgentResponse>('/api/demo-agent');

/** Create the HSP order for these terms and prepare the payment for `payer`: returns the quote to sign. */
export const startPayment = (signed: SignedTerms, payer: string): Promise<PayStartResponse> =>
  post<PayStartResponse>('/api/pay/start', { signed, payer });

/** Hand the wallet's signature to HSP (finalize + submit). */
export const finishPayment = (input: {
  flowId: string;
  paymentRequestId: string;
  signature: string;
  opaque: unknown;
}): Promise<PayFinishResponse> => post<PayFinishResponse>('/api/pay/finish', input);

export function getPaymentStatus(
  flowId: string,
  paymentRequestId?: string,
  signal?: AbortSignal,
): Promise<PayStatusResponse> {
  const query = new URLSearchParams({ flowId });
  if (paymentRequestId) query.set('paymentRequestId', paymentRequestId);
  return call<PayStatusResponse>(`/api/pay/status?${query.toString()}`, { signal });
}

/**
 * Check the settlement on chain and anchor the receipt in NodReceipts on HSK Chain.
 * A failed check comes back as 409 with the full result, which is returned (ok: false), not thrown.
 */
export async function settlePayment(
  signed: SignedTerms,
  flowId: string,
  paymentRequestId?: string,
  payer?: string,
): Promise<SettleResponse> {
  try {
    return await post<SettleResponse>('/api/pay/settle', {
      signed,
      flowId,
      ...(paymentRequestId ? { paymentRequestId } : {}),
      ...(payer ? { payer } : {}),
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'settlement_check_failed' && isRecord(error.body?.check)) {
      return error.body as unknown as SettleResponse;
    }
    throw error;
  }
}

export const getReceipt = (termsHash: string): Promise<ReceiptLookup> =>
  call<ReceiptLookup>(`/api/receipt?${new URLSearchParams({ termsHash }).toString()}`);

export type BuyResult =
  | { status: 'delivered'; item: DeliveredItem }
  /** 402 after every retry: the vendor does not see a matching payment yet. */
  | { status: 'unpaid'; reasons: string[] }
  /** Anything else: no vendor for these terms, server error, network error. */
  | { status: 'unavailable'; message: string; httpStatus: number };

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * `POST /api/vendor/buy`: the demo vendor checks the payment itself and hands over the item.
 * A 402 means it does not see the payment yet, so it is retried `retries` times (2 s, 4 s, 6 s…).
 */
export async function buyFromVendor(
  signed: SignedTerms,
  flowId: string,
  paymentRequestId: string | undefined,
  { retries = 4, gapMs = 2000, signal }: { retries?: number; gapMs?: number; signal?: AbortSignal } = {},
): Promise<BuyResult> {
  let reasons: string[] = [];
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(gapMs * attempt, signal);
    if (signal?.aborted) return { status: 'unavailable', message: 'Cancelled.', httpStatus: 0 };
    try {
      const data = await post<Json>('/api/vendor/buy', { signed, flowId, paymentRequestId }, signal);
      const item = isRecord(data.item) ? data.item : null;
      if (data.ok === true && item && typeof item.title === 'string' && typeof item.body === 'string') {
        const deliveredAt =
          typeof item.deliveredAt === 'number' || typeof item.deliveredAt === 'string' ? item.deliveredAt : Date.now();
        return { status: 'delivered', item: { title: item.title, body: item.body, deliveredAt } };
      }
      return { status: 'unavailable', message: 'The vendor sent an unreadable item.', httpStatus: 200 };
    } catch (error) {
      if (error instanceof ApiError && error.status === 402) {
        const raw = error.body?.reasons;
        reasons = Array.isArray(raw) ? raw.filter((r): r is string => typeof r === 'string') : [];
        continue;
      }
      if (signal?.aborted) return { status: 'unavailable', message: 'Cancelled.', httpStatus: 0 };
      return {
        status: 'unavailable',
        message: error instanceof Error ? error.message : String(error),
        httpStatus: error instanceof ApiError ? error.status : 0,
      };
    }
  }
  return { status: 'unpaid', reasons };
}
