/**
 * The agent's signing key. It only signs payment terms (EIP-712); it never holds or moves money.
 * Order: NOD_AGENT_KEY → <NOD_HOME>/agent.key → create a new one there on first use.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Address, Hex, PrivateKeyAccount } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { nodHome, type Env } from './config.js';

export interface AgentKey {
  /** viem local account: signs the terms. */
  account: PrivateKeyAccount;
  /** Written into every set of terms as `agent`. */
  address: Address;
  source: 'env' | 'file' | 'created';
  /** Key file path when the key came from (or was written to) disk. */
  path?: string;
}

const parseKey = (text: string, where: string): Hex => {
  const hex = text.trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`${where} must be a private key: 64 hex characters, optionally 0x-prefixed`);
  }
  const key = `0x${hex.toLowerCase()}` as Hex;
  try {
    privateKeyToAccount(key);
  } catch {
    throw new Error(`${where} is not a valid secp256k1 private key`);
  }
  return key;
};

const fromKey = (key: Hex, source: AgentKey['source'], path?: string): AgentKey => {
  const account = privateKeyToAccount(key);
  return { account, address: account.address, source, ...(path ? { path } : {}) };
};

export const keyPath = (env: Env = process.env): string => join(nodHome(env), 'agent.key');

/** Load the agent key, creating and saving one on first use. */
export const loadAgentKey = (env: Env = process.env): AgentKey => {
  if (env.NOD_AGENT_KEY && env.NOD_AGENT_KEY.trim() !== '') {
    return fromKey(parseKey(env.NOD_AGENT_KEY, 'NOD_AGENT_KEY'), 'env');
  }
  const path = keyPath(env);
  if (existsSync(path)) return fromKey(parseKey(readFileSync(path, 'utf8'), path), 'file', path);

  const key = generatePrivateKey();
  mkdirSync(nodHome(env), { recursive: true });
  writeFileSync(path, `${key}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best effort on Windows */
  }
  return fromKey(key, 'created', path);
};
