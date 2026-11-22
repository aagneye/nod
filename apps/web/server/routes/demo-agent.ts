/**
 * GET /api/demo-agent: the demo vendor agent (it sells a live weather report) signs fresh terms
 * and returns the approval link.
 */
import { buildTermsUrl, createTerms, hashTerms } from '@nod/protocol';
import type { Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { ServerConfig } from '../config.js';
import { ephemeralAgentKey, type ApiContext, type Logger } from '../context.js';
import { json } from '../http.js';
import type { DemoAgentResponse } from '../types.js';

export const DEMO_MERCHANT = 'Nod weather agent';
export const DEMO_PURPOSE = '1 live weather report';
export const DEMO_TTL_SEC = 15 * 60;
export const EPHEMERAL_WARNING = 'ephemeral agent key';

/** The demo agent's account; `ephemeral` when NOD_DEMO_AGENT_KEY is unset. */
export function demoAgent(cfg: ServerConfig, log?: Logger) {
  const ephemeral = cfg.demo.agentKey === null;
  const account = privateKeyToAccount(cfg.demo.agentKey ?? ephemeralAgentKey(log));
  /** Where the demo agent asks to be paid: NOD_DEMO_VENDOR, else its own address. */
  const payTo: Address = cfg.demo.vendor ?? account.address;
  return { account, ephemeral, payTo };
}

/** Origin for links: NOD_PUBLIC_URL, else the request's own (x-forwarded-proto/host aware). */
export function publicOrigin(request: Request, publicUrl: string | null): string {
  if (publicUrl) return publicUrl;
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host') || url.host;
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || url.protocol.replace(/:$/, '');
  return `${proto}://${host}`;
}

export async function handleDemoAgent(ctx: ApiContext): Promise<Response> {
  const { account, ephemeral, payTo } = demoAgent(ctx.cfg, ctx.log);
  const signed = await createTerms(
    { merchant: DEMO_MERCHANT, payTo, amountUsd: ctx.cfg.demo.amountUsd, purpose: DEMO_PURPOSE, expiresInSec: DEMO_TTL_SEC },
    account,
  );
  const body: DemoAgentResponse = {
    link: buildTermsUrl(publicOrigin(ctx.request, ctx.cfg.publicUrl), signed),
    signed,
    termsHash: hashTerms(signed.terms),
    ...(ephemeral ? { warning: EPHEMERAL_WARNING } : {}),
  };
  return json(200, body);
}
