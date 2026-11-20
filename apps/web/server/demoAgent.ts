/**
 * GET /api/demo-agent: the demo agent signs a fresh Nod request and returns its link.
 */
import { buildRequestUrl, createRequest, hashRequest, toHex, type SignedNodRequest } from '@nod/protocol';
import { demoVendor, readConfig, type Env, type ServerConfig } from './env.js';
import { json } from './http.js';

export const DEMO_AGENT_NAME = 'Nod demo agent';
export const DEMO_PURPOSE = '1 live weather report';
export const DEMO_TTL_SECONDS = 15 * 60;

/** Base URL for links: NOD_PUBLIC_URL, else the request's own host (http only for localhost). */
export function baseUrl(request: Request, publicUrl: string | null): string {
  if (publicUrl) return publicUrl;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || new URL(request.url).host;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  return `${local ? 'http' : 'https'}://${host}`;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function handleDemoAgent(request: Request, env: Env = process.env): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'Use GET' });

  let cfg: ServerConfig;
  try {
    cfg = readConfig(env);
  } catch (e) {
    return json(500, { error: message(e) });
  }
  const vendor = demoVendor(cfg);
  if (!vendor) return json(500, { error: 'NOD_DEMO_VENDOR is not set' });

  const expiresAt = Math.floor(Date.now() / 1000) + DEMO_TTL_SECONDS;
  let signed: SignedNodRequest;
  try {
    signed = createRequest(
      { agentName: DEMO_AGENT_NAME, vendor, amount: { sats: cfg.sats }, purpose: DEMO_PURPOSE, expiry: expiresAt },
      cfg.agentKey,
    );
  } catch (e) {
    return json(500, { error: message(e) });
  }
  return json(200, {
    link: buildRequestUrl(baseUrl(request, cfg.publicUrl), signed),
    hash: toHex(hashRequest(signed.req)),
    network: cfg.network,
    expiresAt,
    request: signed,
    ...(cfg.ephemeral ? { warning: 'ephemeral agent key' } : {}),
  });
}
