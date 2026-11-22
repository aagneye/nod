/**
 * POST /api/vendor/buy: the demo vendor delivers a live weather report once the terms are paid
 * (HSP reports payment-safe or payment-finalized and the transfer checks out on chain).
 * Body: { payload | signed, flowId, paymentRequestId }. 402 { ok: false, reasons } until then.
 * Stateless: a paid request can be redeemed again (demo simplification).
 */
import { usdToRaw, type SignedTerms } from '@nod/protocol';
import type { Hex } from 'viem';
import type { ServerConfig } from '../config.js';
import type { ApiContext, Logger } from '../context.js';
import { HttpError, json, readJsonBody } from '../http.js';
import { optionalPayer, provePayment, requireIds, termsFromBody } from '../settlement.js';
import type { DeliveredItem, VendorBuyResponse } from '../types.js';
import { demoAgent } from './demo-agent.js';

const CITIES = [
  { name: 'Seoul', lat: 37.57, lon: 126.98 },
  { name: 'Hong Kong', lat: 22.32, lon: 114.17 },
  { name: 'Lisbon', lat: 38.72, lon: -9.14 },
  { name: 'Bengaluru', lat: 12.97, lon: 77.59 },
  { name: 'Tokyo', lat: 35.68, lon: 139.69 },
  { name: 'Buenos Aires', lat: -34.6, lon: -58.38 },
  { name: 'Nairobi', lat: -1.29, lon: 36.82 },
  { name: 'Reykjavik', lat: 64.15, lon: -21.94 },
];

/** A live weather report from open-meteo (2 s timeout), or a canned one if that fails. */
export async function weatherReport(termsHash: Hex, fetchImpl: typeof fetch = fetch): Promise<DeliveredItem> {
  const city = CITIES[Number.parseInt(termsHash.slice(2, 4), 16) % CITIES.length]!;
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

/**
 * Are these terms the demo vendor's own offer? The recipient must be the demo payTo and the
 * amount at least the demo price. With NOD_DEMO_AGENT_KEY set, the agent must be the demo agent;
 * an ephemeral key differs per instance, so then the recipient check carries the weight.
 */
export function isDemoOffer(cfg: ServerConfig, signed: SignedTerms, log?: Logger): boolean {
  const { terms } = signed;
  const { account, ephemeral, payTo } = demoAgent(cfg, log);
  if (usdToRaw(terms.amountUsd, 2) < usdToRaw(cfg.demo.amountUsd, 2)) return false;
  if (!ephemeral && terms.agent !== account.address) return false;
  // Without NOD_DEMO_VENDOR the agent asks to be paid at its own address.
  const expectedPayTo = cfg.demo.vendor ?? (ephemeral ? terms.agent : payTo);
  return terms.payTo === expectedPayTo;
}

export async function handleVendorBuy(ctx: ApiContext): Promise<Response> {
  const body = await readJsonBody(ctx.request);
  const { signed, termsHash } = await termsFromBody(body, { allowExpired: true });
  const ids = requireIds(body);
  if (!isDemoOffer(ctx.cfg, signed, ctx.log)) {
    throw new HttpError(400, 'These terms are not an offer from the demo vendor', 'not_demo_vendor');
  }
  const proof = await provePayment(ctx, signed, ids, optionalPayer(body.payer));
  if (!proof.paid || !proof.check.ok) {
    const response: VendorBuyResponse = { ok: false, reasons: proof.check.reasons };
    return json(402, response);
  }
  const response: VendorBuyResponse = { ok: true, item: await weatherReport(termsHash, ctx.fetch) };
  return json(200, response);
}
