/**
 * Server-side configuration for the demo API. Read from the environment on every call so
 * tests and the dev server can change it without restarting.
 */
import { binToHex, encodeCashAddress, hash160, hexToBin, secp256k1 } from '@bitauth/libauth';
import { generateAgentKey, type Network } from '@nod/protocol';

export type Env = Record<string, string | undefined>;

export interface ServerConfig {
  network: Network;
  /** Demo agent's private key (32 bytes). */
  agentKey: Uint8Array;
  /** Compressed public key hex of `agentKey`. */
  agentPubkey: string;
  /** True when `agentKey` was generated at cold start (NOD_DEMO_AGENT_KEY unset). */
  ephemeral: boolean;
  /** NOD_DEMO_VENDOR, or null when unset. */
  vendor: string | null;
  sats: number;
  publicUrl: string | null;
}

export const DEFAULT_SATS = 2000;

let ephemeralKey: Uint8Array | null = null;

const pubkeyHex = (priv: Uint8Array): string => {
  const pub = secp256k1.derivePublicKeyCompressed(priv);
  if (typeof pub === 'string') throw new Error(`NOD_DEMO_AGENT_KEY is not a valid secp256k1 key: ${pub}`);
  return binToHex(pub);
};

/** NOD_NETWORK, else VITE_NETWORK, else chipnet. */
export function readNetwork(env: Env): Network {
  const raw = (env.NOD_NETWORK || env.VITE_NETWORK || 'chipnet').trim().toLowerCase();
  return raw === 'mainnet' ? 'mainnet' : 'chipnet';
}

export function readConfig(env: Env = process.env): ServerConfig {
  const network = readNetwork(env);
  const keyHex = (env.NOD_DEMO_AGENT_KEY ?? '').trim().toLowerCase();
  let agentKey: Uint8Array;
  let ephemeral = false;
  if (keyHex) {
    if (!/^[0-9a-f]{64}$/.test(keyHex)) throw new Error('NOD_DEMO_AGENT_KEY must be 64 hex characters');
    agentKey = hexToBin(keyHex);
  } else {
    if (!ephemeralKey) {
      ephemeralKey = generateAgentKey().privateKey;
      console.warn('[nod] NOD_DEMO_AGENT_KEY is not set; using an ephemeral agent key for this instance.');
    }
    agentKey = ephemeralKey;
    ephemeral = true;
  }
  const sats = Number((env.NOD_DEMO_SATS ?? '').trim() || DEFAULT_SATS);
  if (!Number.isSafeInteger(sats) || sats < 546) throw new Error('NOD_DEMO_SATS must be an integer >= 546');
  const vendor = (env.NOD_DEMO_VENDOR ?? '').trim() || null;
  const publicUrl = (env.NOD_PUBLIC_URL ?? '').trim().replace(/\/+$/, '') || null;
  return { network, agentKey, agentPubkey: pubkeyHex(agentKey), ephemeral, vendor, sats, publicUrl };
}

/** P2PKH cashaddr of a compressed public key (hex). */
export function p2pkhAddress(pubkey: string, network: Network): string {
  return encodeCashAddress({
    prefix: network === 'mainnet' ? 'bitcoincash' : 'bchtest',
    type: 'p2pkh',
    payload: hash160(hexToBin(pubkey)),
    throwErrors: true,
  }).address;
}

/**
 * Vendor the demo agent asks to be paid: NOD_DEMO_VENDOR, else (chipnet only) the agent key's
 * own P2PKH address. Null on mainnet without NOD_DEMO_VENDOR (never send real funds to a key
 * nobody keeps).
 */
export function demoVendor(cfg: ServerConfig): string | null {
  if (cfg.vendor) return cfg.vendor;
  if (cfg.network === 'mainnet') return null;
  return p2pkhAddress(cfg.agentPubkey, cfg.network);
}

/**
 * Is `req` addressed to the demo vendor? With NOD_DEMO_VENDOR set the vendor must equal it.
 * Without it (chipnet only) the vendor must be the P2PKH address of the request's own agent key,
 * and that key must be NOD_DEMO_AGENT_KEY's when one is set. Ephemeral keys differ between
 * serverless instances, so the agent key cannot be pinned in that case.
 */
export function isDemoVendor(cfg: ServerConfig, req: { vendor: string; agent: string }): boolean {
  if (cfg.vendor) return req.vendor === cfg.vendor;
  if (cfg.network === 'mainnet') return false;
  if (!cfg.ephemeral && req.agent !== cfg.agentPubkey) return false;
  return req.vendor === p2pkhAddress(req.agent, cfg.network);
}
