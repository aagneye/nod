/**
 * The /api dispatcher shared by every runtime: the Vite dev middleware (vite.config.ts), the
 * Vercel functions (server/vercel.ts) and the standalone server (server/standalone.ts).
 *
 *   GET  /api/config        contracts, HSP mode/reachability/option, demo price
 *   GET  /api/demo-agent    fresh signed terms from the demo vendor agent
 *   POST /api/pay/start     verify terms → HSP create_order + prepare_payment
 *   POST /api/pay/finish    HSP finalize_payment + submit_payment
 *   GET  /api/pay/status    HSP query_payment
 *   POST /api/pay/settle    settlement check + NodReceipts anchor
 *   GET  /api/receipt       NodReceipts lookup
 *   POST /api/vendor/buy    the demo vendor delivers once paid
 *
 * Errors are JSON `{ error, code? }`; see server/types.ts for every shape.
 */
import { ConfigError, readConfig, type Env, type ServerConfig } from './config.js';
import { consoleLogger, defaultChains, defaultHsp, type ApiContext, type Logger } from './context.js';
import type { ChainAccess } from './chain.js';
import { isHspUnavailable, type HspClient } from './hsp.js';
import { HttpError, errorJson, errorMessage, type Handler } from './http.js';
import { handleConfig } from './routes/config.js';
import { handleDemoAgent } from './routes/demo-agent.js';
import { handlePayFinish, handlePaySettle, handlePayStart, handlePayStatus } from './routes/pay.js';
import { handleReceipt } from './routes/receipt.js';
import { handleVendorBuy } from './routes/vendor.js';

interface Route {
  method: 'GET' | 'POST';
  handle: (ctx: ApiContext) => Promise<Response>;
}

export const ROUTES: Record<string, Route> = {
  '/api/config': { method: 'GET', handle: handleConfig },
  '/api/demo-agent': { method: 'GET', handle: handleDemoAgent },
  '/api/pay/start': { method: 'POST', handle: handlePayStart },
  '/api/pay/finish': { method: 'POST', handle: handlePayFinish },
  '/api/pay/status': { method: 'GET', handle: handlePayStatus },
  '/api/pay/settle': { method: 'POST', handle: handlePaySettle },
  '/api/receipt': { method: 'GET', handle: handleReceipt },
  '/api/vendor/buy': { method: 'POST', handle: handleVendorBuy },
};

export const API_PATHS = Object.keys(ROUTES);

export interface ApiDeps {
  /** Environment to read (default process.env, read per request). */
  env?: Env;
  /** HSP client; default: the process-wide live client or mock, per HSP_MODE. */
  hsp?: HspClient | ((cfg: ServerConfig) => HspClient);
  /** Chain access; default: viem clients on the configured RPC URLs. */
  chains?: ChainAccess | ((cfg: ServerConfig) => ChainAccess);
  /** fetch for the vendor's weather feed. */
  fetch?: typeof fetch;
  log?: Logger;
}

function withHeaders(response: Response, headers: Record<string, string>): Response {
  if (Object.keys(headers).length === 0) return response;
  const merged = new Headers(response.headers);
  for (const [key, value] of Object.entries(headers)) merged.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: merged });
}

function corsHeaders(origin: string | null, request: Request): Record<string, string> {
  if (!origin) return {};
  const requestOrigin = request.headers.get('origin');
  const allowed = origin.split(',').map((o) => o.trim()).filter(Boolean);
  let allow: string | undefined;
  if (allowed.includes('*')) allow = '*';
  else if (requestOrigin && allowed.includes(requestOrigin)) allow = requestOrigin;
  if (!allow) return {};
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '600',
    ...(allow === '*' ? {} : { vary: 'origin' }),
  };
}

function toErrorResponse(error: unknown, log: Logger, path: string): Response {
  if (error instanceof HttpError) return errorJson(error.status, error.message, error.code, error.extra);
  if (isHspUnavailable(error)) return errorJson(503, errorMessage(error), 'hsp_unavailable');
  log.error(`${path}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  return errorJson(500, errorMessage(error), 'internal');
}

/** Build the /api handler. Every dependency can be injected (tests). */
export function createApi(deps: ApiDeps = {}): Handler {
  const log = deps.log ?? consoleLogger;
  return async (request) => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    let cfg: ServerConfig;
    try {
      cfg = readConfig(deps.env ?? process.env);
    } catch (error) {
      const message = error instanceof ConfigError ? error.message : errorMessage(error);
      log.error(message);
      return errorJson(500, message, 'config_error');
    }
    const cors = corsHeaders(cfg.corsOrigin, request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const route = ROUTES[path];
    if (!route) return withHeaders(errorJson(404, `No API route ${path}`, 'not_found'), cors);
    const method = request.method === 'HEAD' ? 'GET' : request.method;
    if (method !== route.method) {
      return withHeaders(errorJson(405, `Use ${route.method} for ${path}`, 'method_not_allowed'), { ...cors, allow: route.method });
    }

    let response: Response;
    try {
      const hsp = typeof deps.hsp === 'function' ? deps.hsp(cfg) : (deps.hsp ?? defaultHsp(cfg, log));
      const chains = typeof deps.chains === 'function' ? deps.chains(cfg) : (deps.chains ?? defaultChains(cfg));
      const ctx: ApiContext = { request, url, cfg, hsp, chains, fetch: deps.fetch ?? fetch, log };
      response = await route.handle(ctx);
    } catch (error) {
      response = toErrorResponse(error, log, path);
    }
    return withHeaders(response, cors);
  };
}

/** The default handler (process env, shared HSP session). */
export const handleApiRequest: Handler = createApi();

/**
 * Connect to HSP once at startup so the live tool list and schemas are logged (live mode only).
 * Never throws; a failure is logged with the allowlist explanation.
 */
export async function warmUpHsp(env: Env = process.env, log: Logger = consoleLogger): Promise<void> {
  try {
    const cfg = readConfig(env);
    const hsp = defaultHsp(cfg, log);
    if (hsp.mode !== 'live' || !hsp.listTools) return;
    log.info(`connecting to HSP at ${cfg.hsp.url} ...`);
    await hsp.listTools();
  } catch (error) {
    log.warn(`HSP warm-up failed: ${errorMessage(error)}`);
  }
}
