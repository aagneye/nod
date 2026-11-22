/**
 * Per-request context and the process-wide singletons behind it: the HSP client (one MCP
 * session reused across requests), chain clients and the ephemeral demo key. Singletons live
 * on globalThis so they survive dev-server module reloads.
 */
import type { Hex } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { createViemChains, type ChainAccess } from './chain.js';
import type { ServerConfig } from './config.js';
import { LiveHspClient, type HspClient } from './hsp.js';
import { createMockHsp } from './hsp-mock.js';

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const consoleLogger: Logger = {
  info: (message) => console.log(`[nod] ${message}`),
  warn: (message) => console.warn(`[nod] ${message}`),
  error: (message) => console.error(`[nod] ${message}`),
};

export const silentLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

export interface ApiContext {
  request: Request;
  url: URL;
  cfg: ServerConfig;
  hsp: HspClient;
  chains: ChainAccess;
  fetch: typeof fetch;
  log: Logger;
}

interface SharedState {
  hsp?: { key: string; moduleId: string; client: HspClient };
  chains?: { key: string; access: ChainAccess };
  ephemeralKey?: Hex;
}

const STATE_KEY = Symbol.for('nod.server.state');
/** Changes whenever this module is re-evaluated (dev reload), so stale clients are replaced. */
const MODULE_ID = Math.random().toString(36).slice(2);

function sharedState(): SharedState {
  const holder = globalThis as unknown as Record<symbol, SharedState | undefined>;
  return (holder[STATE_KEY] ??= {});
}

/** The process-wide HSP client for this configuration (live MCP session, or the mock). */
export function defaultHsp(cfg: ServerConfig, log: Logger = consoleLogger): HspClient {
  const state = sharedState();
  const key = `${cfg.hsp.mode}|${cfg.hsp.url}`;
  if (state.hsp && state.hsp.key === key && state.hsp.moduleId === MODULE_ID) return state.hsp.client;
  void state.hsp?.client.close?.().catch(() => undefined);
  let client: HspClient;
  if (cfg.hsp.mode === 'mock') {
    client = createMockHsp();
    log.warn('HSP_MODE=mock: payments are SIMULATED in memory. Nothing reaches HSP or any chain.');
  } else {
    client = new LiveHspClient({ url: cfg.hsp.url });
  }
  state.hsp = { key, moduleId: MODULE_ID, client };
  return client;
}

/** The process-wide viem clients for the configured RPC URLs. */
export function defaultChains(cfg: ServerConfig): ChainAccess {
  const state = sharedState();
  const key = JSON.stringify(cfg.rpc);
  if (state.chains?.key !== key) state.chains = { key, access: createViemChains(cfg.rpc) };
  return state.chains.access;
}

/** A demo agent key generated once per process (NOD_DEMO_AGENT_KEY unset). */
export function ephemeralAgentKey(log: Logger = consoleLogger): Hex {
  const state = sharedState();
  if (!state.ephemeralKey) {
    state.ephemeralKey = generatePrivateKey();
    log.warn('NOD_DEMO_AGENT_KEY is not set; the demo agent uses an ephemeral key for this process.');
  }
  return state.ephemeralKey;
}
