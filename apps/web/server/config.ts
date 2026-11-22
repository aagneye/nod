/**
 * Server configuration: every environment variable the API reads, validated in one place.
 * Read per request (cheap), so tests and the dev server can change values without a restart.
 * See apps/web/.env.example for the full list with comments.
 */
import { HSP_DEFAULT_MCP_URL, hskMainnet, hskTestnet, sepolia, type PaymentPreference } from '@nod/protocol';
import { getAddress, isAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export type Env = Record<string, string | undefined>;
export type HspMode = 'live' | 'mock';

export interface ServerConfig {
  hsp: {
    /** HSP_MODE: live (default) talks to HSP; mock simulates it in memory (development only). */
    mode: HspMode;
    /** HSP_MCP_URL: HSP Agentic Payment MCP endpoint (Streamable HTTP). */
    url: string;
    /** NOD_MERCHANT_NAME: the team's HSP reporting name. Required by the pay routes in live mode. */
    merchantName: string | null;
    /** NOD_PAY_NETWORK / NOD_PAY_CHAIN_ID / NOD_PAY_COIN: which get_chain_config option to pay with. */
    prefer: PaymentPreference;
  };
  demo: {
    /** NOD_DEMO_AGENT_KEY: the demo vendor agent's signing key; null = ephemeral key. */
    agentKey: Hex | null;
    /** NOD_DEMO_VENDOR: where the demo agent asks to be paid; null = the agent's own address. */
    vendor: Address | null;
    /** NOD_DEMO_USD: price of one demo purchase (default "0.10"). */
    amountUsd: string;
  };
  /** NOD_PUBLIC_URL: origin used in links; null = the request's own origin. */
  publicUrl: string | null;
  receipts: {
    /** NOD_RECEIPTS_CHAIN: hsk-testnet (default) or hsk-mainnet. */
    chainId: number;
    /** NOD_RECEIPTS_ADDRESS: the NodReceipts contract. */
    address: Address | null;
    /** NOD_RECORDER_KEY: key that anchors receipts (needs gas on the receipts chain). */
    recorderKey: Hex | null;
    /** Address of NOD_RECORDER_KEY, or NOD_RECORDER_ADDRESS for read-only deployments. */
    recorder: Address | null;
  };
  policy: {
    /** Same chain as the receipts. */
    chainId: number;
    /** NOD_POLICY_ADDRESS: the NodPolicy contract. */
    address: Address | null;
  };
  /** JSON-RPC URL per chain id (HSK_MAINNET_RPC, HSK_TESTNET_RPC, SEPOLIA_RPC override the defaults). */
  rpc: Record<number, string>;
  /** NOD_CORS_ORIGIN: Access-Control-Allow-Origin for /api (default "*"; "off" disables CORS headers). */
  corsOrigin: string | null;
}

/** Merchant name the mock HSP uses when NOD_MERCHANT_NAME is unset. */
export const MOCK_MERCHANT_NAME = 'Nod (mock HSP)';

export const DEFAULT_DEMO_USD = '0.10';

export const DEFAULT_SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid server configuration: ${problems.join('; ')}`);
    this.name = 'ConfigError';
  }
}

const RECEIPT_CHAINS: Record<string, number> = {
  'hsk-testnet': hskTestnet.id,
  [String(hskTestnet.id)]: hskTestnet.id,
  'hsk-mainnet': hskMainnet.id,
  [String(hskMainnet.id)]: hskMainnet.id,
  // For trying the contracts on Sepolia (contracts/ can deploy there); not a production setting.
  sepolia: sepolia.id,
  [String(sepolia.id)]: sepolia.id,
};

const AMOUNT_USD_RE = /^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/;

export function readConfig(env: Env = process.env): ServerConfig {
  const problems: string[] = [];
  const get = (name: string): string => (env[name] ?? '').trim();

  const fail = <T>(name: string, message: string, fallback: T): T => {
    problems.push(`${name} ${message}`);
    return fallback;
  };

  const address = (name: string): Address | null => {
    const value = get(name);
    if (value === '') return null;
    if (!isAddress(value, { strict: false })) return fail(name, `must be an 0x address, got "${value}"`, null);
    // Mixed case means an EIP-55 checksum was given: it has to be right.
    const body = value.slice(2);
    const mixedCase = body !== body.toLowerCase() && body !== body.toUpperCase();
    if (mixedCase && !isAddress(value)) return fail(name, `has an invalid EIP-55 checksum (typo?): ${value}`, null);
    return getAddress(value);
  };

  const privateKey = (name: string): Hex | null => {
    const value = get(name);
    if (value === '') return null;
    const hex = value.replace(/^0x/i, '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hex)) return fail(name, 'must be a private key: 64 hex characters, optionally 0x-prefixed', null);
    const key = `0x${hex}` as Hex;
    try {
      privateKeyToAccount(key);
    } catch {
      return fail(name, 'is not a valid secp256k1 private key', null);
    }
    return key;
  };

  const httpUrl = (name: string, fallback: string): string => {
    const value = get(name);
    if (value === '') return fallback;
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('not http');
      return value;
    } catch {
      return fail(name, `must be an http(s) URL, got "${value}"`, fallback);
    }
  };

  // --- HSP ---
  const modeRaw = get('HSP_MODE').toLowerCase();
  let mode: HspMode = 'live';
  if (modeRaw === 'mock') mode = 'mock';
  else if (modeRaw !== '' && modeRaw !== 'live') fail('HSP_MODE', `must be "live" or "mock", got "${get('HSP_MODE')}"`, null);

  const merchantName = get('NOD_MERCHANT_NAME') || null;
  if (merchantName && merchantName.length > 128) fail('NOD_MERCHANT_NAME', 'must be at most 128 characters', null);

  const prefer: PaymentPreference = {};
  if (get('NOD_PAY_NETWORK')) prefer.network = get('NOD_PAY_NETWORK');
  if (get('NOD_PAY_COIN')) prefer.coin = get('NOD_PAY_COIN');
  if (get('NOD_PAY_CHAIN_ID')) {
    const chainId = Number(get('NOD_PAY_CHAIN_ID'));
    if (Number.isSafeInteger(chainId) && chainId > 0) prefer.chainId = chainId;
    else fail('NOD_PAY_CHAIN_ID', `must be a positive integer, got "${get('NOD_PAY_CHAIN_ID')}"`, null);
  }

  // --- Demo agent ---
  let amountUsd = get('NOD_DEMO_USD') || DEFAULT_DEMO_USD;
  if (!AMOUNT_USD_RE.test(amountUsd) || Number(amountUsd) <= 0 || Number(amountUsd) > 10000) {
    amountUsd = fail('NOD_DEMO_USD', `must be a USD amount above 0 with at most 2 decimals, like "0.10", got "${amountUsd}"`, DEFAULT_DEMO_USD);
  }

  let publicUrl: string | null = httpUrl('NOD_PUBLIC_URL', '') || null;
  if (publicUrl) publicUrl = publicUrl.replace(/\/+$/, '');

  // --- Contracts on HSK Chain ---
  const chainRaw = get('NOD_RECEIPTS_CHAIN').toLowerCase() || 'hsk-testnet';
  const receiptsChainId =
    RECEIPT_CHAINS[chainRaw] ?? fail('NOD_RECEIPTS_CHAIN', `must be "hsk-testnet" or "hsk-mainnet", got "${chainRaw}"`, hskTestnet.id);

  const recorderKey = privateKey('NOD_RECORDER_KEY');
  const recorderAddress = address('NOD_RECORDER_ADDRESS');
  let recorder: Address | null = recorderAddress;
  if (recorderKey) {
    const fromKey = privateKeyToAccount(recorderKey).address;
    if (recorderAddress && recorderAddress !== fromKey) {
      fail('NOD_RECORDER_ADDRESS', `(${recorderAddress}) does not match NOD_RECORDER_KEY (${fromKey})`, null);
    }
    recorder = fromKey;
  }

  const rpc: Record<number, string> = {
    [hskMainnet.id]: httpUrl('HSK_MAINNET_RPC', hskMainnet.rpcUrls.default.http[0]),
    [hskTestnet.id]: httpUrl('HSK_TESTNET_RPC', hskTestnet.rpcUrls.default.http[0]),
    [sepolia.id]: httpUrl('SEPOLIA_RPC', DEFAULT_SEPOLIA_RPC),
  };

  const corsRaw = get('NOD_CORS_ORIGIN');
  const corsOrigin = corsRaw === '' ? '*' : /^(off|none|false)$/i.test(corsRaw) ? null : corsRaw;

  const config: ServerConfig = {
    hsp: { mode, url: httpUrl('HSP_MCP_URL', HSP_DEFAULT_MCP_URL), merchantName, prefer },
    demo: { agentKey: privateKey('NOD_DEMO_AGENT_KEY'), vendor: address('NOD_DEMO_VENDOR'), amountUsd },
    publicUrl,
    receipts: { chainId: receiptsChainId, address: address('NOD_RECEIPTS_ADDRESS'), recorderKey, recorder },
    policy: { chainId: receiptsChainId, address: address('NOD_POLICY_ADDRESS') },
    rpc,
    corsOrigin,
  };
  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}

/** The merchant name used with HSP: NOD_MERCHANT_NAME, or a placeholder in mock mode. */
export function merchantNameFor(config: ServerConfig, mode: HspMode): string | null {
  return config.hsp.merchantName ?? (mode === 'mock' ? MOCK_MERCHANT_NAME : null);
}
