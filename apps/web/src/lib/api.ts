import type { SignedNodRequest } from '@nod/protocol';
import { API_BASE } from '../config';

export interface DemoLink {
  link: string;
  hash?: string;
  network?: string;
  /** Unix seconds (per the contract); undefined when the endpoint did not say. */
  expiresAt?: number;
  /** e.g. "ephemeral agent key" when NOD_DEMO_AGENT_KEY is unset on the server. */
  warning?: string;
}

/**
 * Ask the demo agent (`GET /api/demo-agent`) for a signed request link.
 * Accepts `{ link, hash, network, expiresAt, warning? }` JSON or a plain-text URL.
 */
export async function fetchDemoAgent(): Promise<DemoLink> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/demo-agent`, { headers: { accept: 'application/json' }, cache: 'no-store' });
  } catch {
    throw new Error('Could not reach the demo agent endpoint.');
  }
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === 'string') detail = `: ${body.error}`;
    } catch {
      /* not JSON */
    }
    throw new Error(`Demo agent responded ${res.status}${detail}.`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('json')) {
    const data = (await res.json()) as Record<string, unknown> | null;
    const link = data?.link ?? data?.url;
    if (typeof link !== 'string') throw new Error('Demo agent did not return a link.');
    return {
      link,
      hash: typeof data?.hash === 'string' ? data.hash : undefined,
      network: typeof data?.network === 'string' ? data.network : undefined,
      expiresAt: typeof data?.expiresAt === 'number' ? data.expiresAt : undefined,
      warning: typeof data?.warning === 'string' && data.warning ? data.warning : undefined,
    };
  }
  const text = (await res.text()).trim();
  if (!/^https?:\/\//.test(text)) throw new Error('Demo agent did not return a link.');
  return { link: text };
}

/** Back-compat helper: just the link. */
export async function fetchDemoLink(): Promise<string> {
  return (await fetchDemoAgent()).link;
}

export interface DeliveredItem {
  title: string;
  body: string;
  deliveredAt: number;
}

export type BuyResult =
  | { status: 'delivered'; item: DeliveredItem }
  /** 402 after all retries: the vendor does not (yet) see a matching payment. */
  | { status: 'unpaid'; reasons: string[] }
  /** 404 / 400 / 5xx / network error: no demo vendor here, so the UI hides the section. */
  | { status: 'unavailable'; message: string };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `POST /api/vendor/buy { txid, signed }`: the demo vendor checks the receipt
 * on-chain and hands over the item. A fresh tx may not have reached the
 * vendor's Electrum server yet, so 402 is retried `retries` times with a
 * growing gap (2 s, 4 s, 6 s by default).
 */
export async function buyFromVendor(
  txid: string,
  signed: SignedNodRequest,
  { retries = 3, gapMs = 2000, signal }: { retries?: number; gapMs?: number; signal?: AbortSignal } = {},
): Promise<BuyResult> {
  let lastReasons: string[] = [];
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(gapMs * attempt);
    if (signal?.aborted) return { status: 'unavailable', message: 'aborted' };
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/api/vendor/buy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ txid, signed: { req: signed.req, sig: signed.sig } }),
        cache: 'no-store',
        signal,
      });
    } catch (e) {
      return { status: 'unavailable', message: e instanceof Error ? e.message : String(e) };
    }
    let data: Record<string, unknown> | null = null;
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      /* non-JSON (e.g. the SPA fallback HTML when the endpoint is absent) */
    }
    if (res.status === 200 && data?.ok === true && data.item && typeof data.item === 'object') {
      const item = data.item as Record<string, unknown>;
      if (typeof item.title === 'string' && typeof item.body === 'string') {
        return {
          status: 'delivered',
          item: {
            title: item.title,
            body: item.body,
            deliveredAt: typeof item.deliveredAt === 'number' ? item.deliveredAt : Date.now(),
          },
        };
      }
      return { status: 'unavailable', message: 'Vendor returned a malformed item.' };
    }
    if (res.status === 402) {
      lastReasons = Array.isArray(data?.reasons)
        ? (data.reasons as unknown[]).filter((r): r is string => typeof r === 'string')
        : [];
      continue;
    }
    return {
      status: 'unavailable',
      message: typeof data?.error === 'string' ? data.error : `Vendor responded ${res.status}.`,
    };
  }
  return { status: 'unpaid', reasons: lastReasons };
}
