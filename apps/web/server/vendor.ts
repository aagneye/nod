/**
 * POST /api/vendor/buy: the demo vendor checks the payment on chain and delivers the item.
 * Body: { txid, signed } (or { txid, payload } with a link payload / full link).
 * Stateless: a paid request can be redeemed again (documented demo simplification).
 */
import {
  NodElectrum,
  decodeLink,
  hashRequest,
  toHex,
  verifyReceipt,
  verifyRequest,
  type ChainReader,
  type Network,
  type ReceiptCheck,
  type SignedNodRequest,
} from '@nod/protocol';
import { isDemoVendor, readConfig, type Env, type ServerConfig } from './env.js';
import { json } from './http.js';

export interface DeliveredItem {
  title: string;
  body: string;
  deliveredAt: number;
}

export type ConnectedChain = ChainReader & { disconnect?: () => Promise<void> };

export interface VendorDeps {
  env?: Env;
  /** Returns a connected chain reader; throwing means "no Electrum server answered" (500). */
  connectChain?: (network: Network) => Promise<ConnectedChain>;
  fetch?: typeof fetch;
}

const defaultConnect = async (network: Network): Promise<ConnectedChain> => {
  const chain = new NodElectrum(network);
  await chain.connect();
  return chain;
};

const CITIES = [
  { name: 'Lisbon', lat: 38.72, lon: -9.14 },
  { name: 'Bengaluru', lat: 12.97, lon: 77.59 },
  { name: 'Tokyo', lat: 35.68, lon: 139.69 },
  { name: 'Buenos Aires', lat: -34.6, lon: -58.38 },
  { name: 'Nairobi', lat: -1.29, lon: 36.82 },
  { name: 'Reykjavik', lat: 64.15, lon: -21.94 },
];

/** A live weather report from open-meteo (2 s timeout), or a canned one if that fails. */
export async function weatherReport(requestHash: Uint8Array, fetchImpl: typeof fetch = fetch): Promise<DeliveredItem> {
  const city = CITIES[requestHash[0]! % CITIES.length]!;
  const title = `Weather report: ${city.name}`;
  const deliveredAt = Math.floor(Date.now() / 1000);
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}` +
      '&current=temperature_2m,relative_humidity_2m,wind_speed_10m';
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`open-meteo ${res.status}`);
    const data = (await res.json()) as {
      current?: { time?: string; temperature_2m?: number; relative_humidity_2m?: number; wind_speed_10m?: number };
    };
    const c = data.current;
    if (!c || typeof c.temperature_2m !== 'number') throw new Error('open-meteo: no current data');
    return {
      title,
      body:
        `${city.name} now: ${c.temperature_2m} °C, humidity ${c.relative_humidity_2m ?? '?'}%, ` +
        `wind ${c.wind_speed_10m ?? '?'} km/h (open-meteo.com, ${c.time ?? 'latest'} UTC).`,
      deliveredAt,
    };
  } catch {
    return {
      title,
      body: `${city.name}: live feed unavailable, cached report from the vendor: 21 °C, light breeze, clear skies.`,
      deliveredAt,
    };
  }
}

/** Pull `{ txid, signed }` out of an unknown body; returns an error string when malformed. */
function parseBody(body: unknown): { txid: string; signed: SignedNodRequest } | string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return 'Body must be a JSON object';
  const b = body as { txid?: unknown; signed?: unknown; payload?: unknown };
  if (typeof b.txid !== 'string' || !/^[0-9a-fA-F]{64}$/.test(b.txid)) return 'txid must be 64 hex characters';
  let signed: unknown = b.signed;
  if (signed === undefined && typeof b.payload === 'string') {
    try {
      signed = decodeLink(b.payload.replace(/^.*#/, '')).signed;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }
  if (typeof signed !== 'object' || signed === null) return 'signed (or payload) is required';
  if (!verifyRequest(signed as SignedNodRequest)) return 'signed is not a validly signed Nod request';
  return { txid: b.txid.toLowerCase(), signed: signed as SignedNodRequest };
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function handleVendorBuy(request: Request, deps: VendorDeps = {}): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'Use POST' });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Body must be JSON' });
  }
  const parsed = parseBody(body);
  if (typeof parsed === 'string') return json(400, { error: parsed });

  let cfg: ServerConfig;
  try {
    cfg = readConfig(deps.env ?? process.env);
  } catch (e) {
    return json(500, { error: message(e) });
  }
  const req = parsed.signed.req;
  if (!isDemoVendor(cfg, req)) return json(400, { error: 'This request is not for the demo vendor' });

  let chain: ConnectedChain;
  try {
    chain = await (deps.connectChain ?? defaultConnect)(cfg.network);
  } catch (e) {
    return json(500, { error: message(e) });
  }
  const requestHash = hashRequest(req);
  let check: ReceiptCheck;
  try {
    check = await verifyReceipt(chain, parsed.txid, req, requestHash);
  } finally {
    await chain.disconnect?.().catch(() => undefined);
  }
  if (!check.ok) return json(402, { ok: false, reasons: check.reasons });

  const item = await weatherReport(requestHash, deps.fetch);
  return json(200, { ok: true, txid: parsed.txid, hash: toHex(requestHash), item });
}
