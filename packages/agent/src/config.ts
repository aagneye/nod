/**
 * Environment-driven settings shared by the CLI and the MCP server.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Network } from '@nod/protocol';

/** Directory holding agent.key and requests.json. NOD_HOME overrides ~/.nod (used by tests). */
export const nodHome = (env: NodeJS.ProcessEnv = process.env): string =>
  env.NOD_HOME && env.NOD_HOME.trim() !== '' ? env.NOD_HOME : join(homedir(), '.nod');

/** NOD_NETWORK (mainnet | chipnet), default chipnet. Never defaults to real money. */
export const nodNetwork = (env: NodeJS.ProcessEnv = process.env): Network => {
  const raw = (env.NOD_NETWORK ?? 'chipnet').trim().toLowerCase();
  if (raw !== 'mainnet' && raw !== 'chipnet') {
    throw new Error(`NOD_NETWORK must be "mainnet" or "chipnet", got "${env.NOD_NETWORK}"`);
  }
  return raw;
};

/** Web app that renders approval links. NOD_BASE_URL, else the local dev server. */
export const nodBaseUrl = (env: NodeJS.ProcessEnv = process.env): string =>
  (env.NOD_BASE_URL && env.NOD_BASE_URL.trim()) || 'http://localhost:5173';

/** Label shown on the approval page. NOD_AGENT_NAME, else "Nod agent". */
export const nodAgentName = (env: NodeJS.ProcessEnv = process.env): string =>
  (env.NOD_AGENT_NAME && env.NOD_AGENT_NAME.trim()) || 'Nod agent';
