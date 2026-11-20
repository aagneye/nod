/**
 * The agent's signing key. It only signs requests; it never holds or moves money.
 * Order: NOD_AGENT_KEY (64 hex) → <NOD_HOME>/agent.key → create a new one there.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeCashAddress, hash160, secp256k1 } from '@bitauth/libauth';
import { CASHADDR_PREFIX, fromHex, generateAgentKey, toHex, type Network } from '@nod/protocol';
import { nodHome } from './config.js';

export interface AgentKey {
  privateKey: Uint8Array;
  /** 66-char compressed public key hex, written into every request as `agent`. */
  publicKey: string;
  source: 'env' | 'file' | 'created';
  /** Key file path when the key came from (or was written to) disk. */
  path?: string;
}

const HEX64 = /^[0-9a-fA-F]{64}$/;

const publicKeyOf = (privateKey: Uint8Array): string => {
  const pub = secp256k1.derivePublicKeyCompressed(privateKey);
  if (typeof pub === 'string') throw new Error(`Invalid agent private key: ${pub}`);
  return toHex(pub);
};

const parseKey = (text: string, where: string): Uint8Array => {
  const hex = text.trim();
  if (!HEX64.test(hex)) throw new Error(`${where} must be 64 hex characters (a secp256k1 private key)`);
  const key = fromHex(hex.toLowerCase());
  if (!secp256k1.validatePrivateKey(key)) throw new Error(`${where} is not a valid secp256k1 private key`);
  return key;
};

export const keyPath = (env: NodeJS.ProcessEnv = process.env): string => join(nodHome(env), 'agent.key');

/** Load the agent key, creating and saving one on first use. */
export const loadAgentKey = (env: NodeJS.ProcessEnv = process.env): AgentKey => {
  if (env.NOD_AGENT_KEY && env.NOD_AGENT_KEY.trim() !== '') {
    const privateKey = parseKey(env.NOD_AGENT_KEY, 'NOD_AGENT_KEY');
    return { privateKey, publicKey: publicKeyOf(privateKey), source: 'env' };
  }
  const path = keyPath(env);
  if (existsSync(path)) {
    const privateKey = parseKey(readFileSync(path, 'utf8'), path);
    return { privateKey, publicKey: publicKeyOf(privateKey), source: 'file', path };
  }
  const { privateKey, publicKey } = generateAgentKey();
  mkdirSync(nodHome(env), { recursive: true });
  writeFileSync(path, `${toHex(privateKey)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best effort on Windows */
  }
  return { privateKey, publicKey, source: 'created', path };
};

/**
 * P2PKH address of the agent public key. Identity only: nobody should send funds here,
 * the agent never needs a balance.
 */
export const agentAddress = (publicKey: string, network: Network): string =>
  encodeCashAddress({
    payload: hash160(fromHex(publicKey)),
    prefix: CASHADDR_PREFIX[network],
    throwErrors: true,
    type: 'p2pkh',
  }).address;
