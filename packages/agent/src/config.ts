/**
 * Environment-driven settings shared by the CLI and the MCP server.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

export type Env = NodeJS.ProcessEnv;

/** Directory holding agent.key and terms.json. NOD_HOME overrides ~/.nod (used by tests). */
export const nodHome = (env: Env = process.env): string =>
  env.NOD_HOME && env.NOD_HOME.trim() !== '' ? env.NOD_HOME : join(homedir(), '.nod');

/** The Nod app: approval links point here and status checks call its /api/receipt. */
export const nodBaseUrl = (env: Env = process.env): string =>
  ((env.NOD_BASE_URL && env.NOD_BASE_URL.trim()) || 'http://localhost:5173').replace(/\/+$/, '');

/** Merchant name shown to the payer when none is given. NOD_AGENT_NAME, else "Nod agent". */
export const nodAgentName = (env: Env = process.env): string =>
  (env.NOD_AGENT_NAME && env.NOD_AGENT_NAME.trim()) || 'Nod agent';
