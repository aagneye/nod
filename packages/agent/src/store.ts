/**
 * Local log of the requests this agent created: <NOD_HOME>/requests.json.
 * Links are stateless, so this is only the agent's memory of what it asked for.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Network, SignedNodRequest } from '@nod/protocol';
import { nodHome } from './config.js';

export interface StoredRequest {
  /** Request id (32 hex). */
  id: string;
  /** sha256 of the canonical request (64 hex); this is what the on-chain NOD memo commits. */
  hash: string;
  /** Full approval link to send to the human. */
  link: string;
  network: Network;
  /** Unix milliseconds. */
  createdAt: number;
  signed: SignedNodRequest;
  /** Filled in once a status check finds the payment. */
  paidTxid?: string;
}

export const storePath = (env: NodeJS.ProcessEnv = process.env): string => join(nodHome(env), 'requests.json');

export const readStore = (env: NodeJS.ProcessEnv = process.env): StoredRequest[] => {
  const path = storePath(env);
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8').trim();
  if (text === '') return [];
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error(`${path} is not a JSON array`);
  return data as StoredRequest[];
};

const writeStore = (records: StoredRequest[], env: NodeJS.ProcessEnv): void => {
  mkdirSync(nodHome(env), { recursive: true });
  const path = storePath(env);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
};

export const addRequest = (record: StoredRequest, env: NodeJS.ProcessEnv = process.env): void => {
  const records = readStore(env).filter((r) => r.id !== record.id);
  records.push(record);
  writeStore(records, env);
};

/** Find by full id, full hash, or a unique prefix (at least 4 chars) of either. */
export const findRequest = (key: string, env: NodeJS.ProcessEnv = process.env): StoredRequest | undefined => {
  const k = key.trim().toLowerCase();
  if (k.length < 4) return undefined;
  const records = readStore(env);
  const exact = records.find((r) => r.id === k || r.hash === k);
  if (exact) return exact;
  const matches = records.filter((r) => r.id.startsWith(k) || r.hash.startsWith(k));
  if (matches.length > 1) throw new Error(`"${key}" matches ${matches.length} requests; use more characters`);
  return matches[0];
};

export const markPaid = (id: string, txid: string, env: NodeJS.ProcessEnv = process.env): void => {
  const records = readStore(env);
  const r = records.find((x) => x.id === id);
  if (!r || r.paidTxid === txid) return;
  r.paidTxid = txid;
  writeStore(records, env);
};
