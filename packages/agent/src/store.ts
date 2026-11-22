/**
 * Local log of the payment terms this agent created: <NOD_HOME>/terms.json.
 * Links are stateless, so this is only the agent's memory of what it asked for.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SignedTerms } from '@nod/protocol';
import type { Hex } from 'viem';
import { nodHome, type Env } from './config.js';

export interface StoredRequest {
  /** Terms id (bytes16: 0x + 32 hex). */
  id: Hex;
  /** EIP-712 hash of the terms (bytes32): the key NodReceipts anchors the payment under. */
  termsHash: Hex;
  /** Full approval link to send to the person who pays. */
  link: string;
  /** Unix milliseconds. */
  createdAt: number;
  signed: SignedTerms;
  /** Filled in once a status check finds the receipt anchored. */
  paid?: { settlementTx: Hex; chainId: number; checkedAt: number };
}

export const storePath = (env: Env = process.env): string => join(nodHome(env), 'terms.json');

const isStored = (value: unknown): value is StoredRequest => {
  const r = value as Partial<StoredRequest> | null;
  return (
    typeof r === 'object' &&
    r !== null &&
    typeof r.id === 'string' &&
    typeof r.termsHash === 'string' &&
    typeof r.link === 'string' &&
    typeof r.signed?.terms === 'object' &&
    r.signed.terms !== null
  );
};

export const readStore = (env: Env = process.env): StoredRequest[] => {
  const path = storePath(env);
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8').trim();
  if (text === '') return [];
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error(`${path} is not a JSON array`);
  return data.filter(isStored);
};

const writeStore = (records: StoredRequest[], env: Env): void => {
  mkdirSync(nodHome(env), { recursive: true });
  const path = storePath(env);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
};

export const addRequest = (record: StoredRequest, env: Env = process.env): void => {
  const records = readStore(env).filter((r) => r.id !== record.id);
  records.push(record);
  writeStore(records, env);
};

const bare = (hex: string): string => hex.trim().toLowerCase().replace(/^0x/, '');

/** Find by full id, full termsHash, or a unique prefix (at least 4 hex chars) of either; 0x is optional. */
export const findRequest = (key: string, env: Env = process.env): StoredRequest | undefined => {
  const k = bare(key);
  if (k.length < 4 || !/^[0-9a-f]+$/.test(k)) return undefined;
  const records = readStore(env);
  const exact = records.find((r) => bare(r.id) === k || bare(r.termsHash) === k);
  if (exact) return exact;
  const matches = records.filter((r) => bare(r.id).startsWith(k) || bare(r.termsHash).startsWith(k));
  if (matches.length > 1) throw new Error(`"${key}" matches ${matches.length} requests; use more characters`);
  return matches[0];
};

export const markPaid = (termsHash: Hex, paid: { settlementTx: Hex; chainId: number }, env: Env = process.env): void => {
  const records = readStore(env);
  const r = records.find((x) => bare(x.termsHash) === bare(termsHash));
  if (!r || r.paid?.settlementTx === paid.settlementTx) return;
  r.paid = { ...paid, checkedAt: Date.now() };
  writeStore(records, env);
};
