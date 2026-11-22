/**
 * HSP (HashKey Settlement Platform) Agentic Payment helpers (PROTOCOL §2).
 * Pure functions, no network calls: the server owns the MCP client and passes tool results in.
 * Tool output shapes are not pinned down by public docs, so every parser here reads
 * snake_case or camelCase keys and tolerates wrapper objects.
 */
import { bytesToHex, getAddress, isAddress, type Address, type Hash, type Hex } from 'viem';
import { hskTestnet } from './chains.js';
import { MAX_CART_TTL_SEC, MAX_DISPLAY_LABEL_LENGTH, X402_METHOD } from './constants.js';
import { hashTerms, isExpired, parseTerms, type NodTerms } from './terms.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HspPaymentProtocol = 'eip3009' | 'permit2';

/** One token on one network that HSP can settle (from `get_chain_config`). */
export interface HspPaymentOption {
  network: string;
  chainId: number;
  contractAddress: Address;
  coin: string;
  decimals: number;
  paymentProtocol: HspPaymentProtocol;
}

export interface PaymentPreference {
  /** HSP network name (e.g. NOD_PAY_NETWORK); a chain id as a string also matches. */
  network?: string;
  chainId?: number;
  coin?: string;
}

export interface HspAmount {
  currency: 'USD';
  value: string;
}

/** The `cart_mandate` argument of `create_order`, exactly as PROTOCOL §2 lays it out. */
export interface CartMandate {
  contents: {
    id: string;
    user_cart_confirmation_required: true;
    cart_expiry: string;
    merchant_name: string;
    payment_request: {
      method_data: Array<{
        supported_methods: string;
        data: {
          x402Version: 2;
          network: string;
          chain_id: number;
          contract_address: Address;
          pay_to: Address;
          coin: string;
        };
      }>;
      details: {
        id: string;
        display_items: Array<{ label: string; amount: HspAmount }>;
        total: { label: 'Total'; amount: HspAmount };
      };
    };
  };
}

export interface BuildCartMandateInput {
  terms: NodTerms;
  /** hashTerms(terms); checked against the terms. */
  termsHash: Hex;
  option: HspPaymentOption;
  /** The team's HSP reporting name (NOD_MERCHANT_NAME). */
  merchantName: string;
  /** Unix seconds; defaults to now. */
  now?: number;
}

/** EIP-712 payload from `prepare_payment`; the payer's wallet signs it unchanged. */
export interface HspEip712 {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface HspPrepared {
  eip712: HspEip712;
  /** eip712.domain.chainId: the chain the wallet must be switched to before signing. */
  chainId?: number;
  /** Token amount in base units the payer authorizes. */
  tokenTotalRaw: bigint;
  /** When the quote expires, unix seconds (about 5 minutes after prepare_payment). */
  quoteExpiresAt?: number;
  payTo?: Address;
  payer?: Address;
  paymentRequestId?: string;
  /** Pass these unchanged to `finalize_payment` with the signature. */
  opaque: {
    payment_payload: unknown;
    payment_mandate_contents: unknown;
    cart_hash: unknown;
  };
}

export interface HspOrder {
  flowId: string;
  paymentRequestId: string;
  paymentUrl?: string;
}

export type HspOutcome = 'paid' | 'pending' | 'failed' | 'unknown';

export interface HspPaymentStatus {
  status: string;
  /** What `status` means for a poller: stop on paid or failed. */
  outcome: HspOutcome;
  /** payment.tx_signature: the settlement transaction on the payment network. */
  txHash?: Hash;
  network?: string;
  payer?: Address;
  payTo?: Address;
  attributionVerified?: boolean;
  statusReason?: string;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export const HSP_PAID_STATES = ['payment-safe', 'payment-finalized'] as const;
export const HSP_PENDING_STATES = [
  'payment-submitted',
  'payment-verified',
  'payment-processing',
  'payment-included',
  'payment-timeout',
] as const;
export const HSP_FAILED_STATE = 'payment-failed';

/** Gateway error code for an expired quote: prepare and sign again. */
export const HSP_QUOTE_EXPIRED_CODE = 30043;

const normalizeStatus = (status: string): string => status.trim().toLowerCase().replace(/[_\s]+/g, '-');

/** paid (payment-safe, payment-finalized), failed (payment-failed), pending (keep polling) or unknown. */
export function hspOutcome(status: string): HspOutcome {
  const s = normalizeStatus(status);
  if ((HSP_PAID_STATES as readonly string[]).includes(s)) return 'paid';
  if (s === HSP_FAILED_STATE) return 'failed';
  if ((HSP_PENDING_STATES as readonly string[]).includes(s)) return 'pending';
  return 'unknown';
}

/** True for errors that mean the HSP quote expired (Gateway code 30043): call prepare_payment again. */
export function isQuoteExpiredError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : safeJson(error);
  return text.includes(String(HSP_QUOTE_EXPIRED_CODE)) || /quote[^.]*expir|expired\s+quote/i.test(text);
}

// ---------------------------------------------------------------------------
// Generic JSON helpers
// ---------------------------------------------------------------------------

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normKey = (key: string): string => key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const present = (value: unknown): boolean => value !== undefined && value !== null && value !== '';

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)) ?? String(value);
  } catch {
    return String(value);
  }
}

const preview = (value: unknown): string => {
  const text = safeJson(value);
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
};

/** The first present value on `record` under any of `aliases` (compared without case, `_` or `-`). */
function field(record: JsonRecord, aliases: readonly string[]): unknown {
  const byKey = new Map<string, unknown>();
  for (const [key, value] of Object.entries(record)) {
    const k = normKey(key);
    if (!byKey.has(k) && present(value)) byKey.set(k, value);
  }
  for (const alias of aliases) {
    const value = byKey.get(normKey(alias));
    if (present(value)) return value;
  }
  return undefined;
}

/**
 * Breadth-first search for the first present value stored under any of `keys`
 * (snake_case and camelCase match each other). Shallower matches win.
 */
export function findField(raw: unknown, keys: readonly string[], maxDepth = 8): unknown {
  let level: unknown[] = [raw];
  for (let depth = 0; depth <= maxDepth && level.length > 0; depth++) {
    const next: unknown[] = [];
    for (const node of level) {
      if (Array.isArray(node)) {
        next.push(...node);
      } else if (isRecord(node)) {
        const value = field(node, keys);
        if (value !== undefined) return value;
        next.push(...Object.values(node));
      }
    }
    level = next;
  }
  return undefined;
}

/** The record that directly holds one of `keys`, searched breadth-first. */
function findHolder(raw: unknown, keys: readonly string[], maxDepth = 8): JsonRecord | undefined {
  let level: unknown[] = [raw];
  for (let depth = 0; depth <= maxDepth && level.length > 0; depth++) {
    const next: unknown[] = [];
    for (const node of level) {
      if (Array.isArray(node)) {
        next.push(...node);
      } else if (isRecord(node)) {
        if (field(node, keys) !== undefined) return node;
        next.push(...Object.values(node));
      }
    }
    level = next;
  }
  return undefined;
}

/** JSON text to a value; one level of double encoding ("\"{...}\"") is undone. */
function parseJsonText(text: string): unknown {
  let value: unknown = JSON.parse(text);
  if (typeof value === 'string') {
    const inner = value.trim();
    if (inner.startsWith('{') || inner.startsWith('[')) value = JSON.parse(inner);
  }
  return value;
}

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : typeof value === 'number' ? String(value) : undefined;

const asAddress = (value: unknown): Address | undefined =>
  typeof value === 'string' && isAddress(value.trim(), { strict: false }) ? getAddress(value.trim()) : undefined;

function asInt(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined;
  if (typeof value === 'bigint') return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= 0n ? Number(value) : undefined;
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  if (/^[0-9]+$/.test(s)) return asInt(Number(s));
  if (/^0x[0-9a-f]+$/i.test(s)) return asInt(Number.parseInt(s, 16));
  return undefined;
}

function asBigInt(value: unknown): bigint | undefined {
  if (typeof value === 'bigint') return value >= 0n ? value : undefined;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : undefined;
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  return /^[0-9]+$/.test(s) || /^0x[0-9a-f]+$/i.test(s) ? BigInt(s) : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1) return true;
  if (value === 'false' || value === 0) return false;
  return undefined;
}

const asHash = (value: unknown): Hash | undefined => {
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(s)) return s.toLowerCase() as Hash;
  if (/^[0-9a-fA-F]{64}$/.test(s)) return `0x${s.toLowerCase()}`;
  return undefined;
};

/** Unix seconds from seconds, milliseconds, a numeric string or an RFC 3339 date. */
function asUnixSeconds(value: unknown): number | undefined {
  const fromNumber = (n: number): number | undefined => {
    const seconds = n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
    return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : undefined;
  };
  if (typeof value === 'number') return Number.isFinite(value) ? fromNumber(value) : undefined;
  if (typeof value === 'bigint') return value > 0n && value < 10n ** 15n ? fromNumber(Number(value)) : undefined;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const s = value.trim();
  if (/^[0-9]+$/.test(s)) return s.length <= 16 ? fromNumber(Number(s)) : undefined;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? undefined : fromNumber(ms);
}

// ---------------------------------------------------------------------------
// MCP tool results
// ---------------------------------------------------------------------------

function looksLikeToolResult(value: unknown): value is JsonRecord {
  if (!isRecord(value)) return false;
  if ('structuredContent' in value || 'toolResult' in value) return true;
  if (typeof value.isError === 'boolean') return true;
  return Array.isArray(value.content) && value.content.every((item) => isRecord(item) && typeof item.type === 'string');
}

/**
 * The JSON object inside an MCP tool result: `structuredContent` when present, otherwise the
 * first `content` text item that parses as JSON. Throws with the tool's error text when
 * `isError` is true. Plain objects (already unwrapped) and JSON strings pass through.
 */
export function unwrapToolResult<T = Record<string, unknown>>(result: unknown, toolName = 'HSP tool'): T {
  if (typeof result === 'string') {
    try {
      return parseJsonText(result) as T;
    } catch {
      throw new Error(`${toolName} returned text that is not JSON: ${result.slice(0, 200)}`);
    }
  }
  if (!looksLikeToolResult(result)) return result as T;

  const texts = (Array.isArray(result.content) ? result.content : [])
    .filter((item): item is JsonRecord => isRecord(item) && item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text as string);

  if (result.isError === true) {
    const detail =
      texts.join('\n').trim() ||
      (result.structuredContent !== undefined ? preview(result.structuredContent) : '') ||
      'no error text';
    throw new Error(`${toolName} failed: ${detail}`);
  }
  if (isRecord(result.structuredContent) || Array.isArray(result.structuredContent)) {
    return result.structuredContent as T;
  }
  if ('toolResult' in result && result.toolResult !== undefined) {
    return unwrapToolResult<T>(result.toolResult, toolName);
  }
  for (const text of [...texts, texts.join('')]) {
    try {
      const value = parseJsonText(text);
      if (isRecord(value) || Array.isArray(value)) return value as T;
    } catch {
      // not JSON; try the next item
    }
  }
  if (texts.length === 0) throw new Error(`${toolName} returned no content`);
  throw new Error(`${toolName} returned text that is not JSON: ${texts.join('\n').slice(0, 200)}`);
}

const unwrapLoose = (raw: unknown, toolName: string): unknown =>
  typeof raw === 'string' || looksLikeToolResult(raw) ? unwrapToolResult<unknown>(raw, toolName) : raw;

// ---------------------------------------------------------------------------
// get_chain_config
// ---------------------------------------------------------------------------

const NETWORK_KEYS = ['network', 'network_name', 'network_id', 'chain_name'];
const CHAIN_ID_KEYS = ['chain_id', 'evm_chain_id', 'chain'];
const ADDRESS_KEYS = ['contract_address', 'token_address', 'address', 'token_contract', 'contract', 'asset', 'token'];
const COIN_KEYS = ['coin', 'symbol', 'token_symbol', 'coin_symbol', 'asset_symbol', 'currency', 'token', 'asset', 'coin_name', 'token_name'];
const DECIMALS_KEYS = ['decimals', 'decimal', 'token_decimals', 'precision'];
const PROTOCOL_KEYS = [
  'payment_protocol',
  'payment_protocols',
  'protocol',
  'protocols',
  'supported_protocols',
  'asset_transfer_method',
  'transfer_method',
  'payment_method',
  'payment_methods',
];
const TOKEN_LIST_KEYS = ['tokens', 'assets', 'coins', 'currencies', 'supported_tokens', 'payment_tokens'];
/** Keys that hold lists or wrappers, never a network or coin name. */
const CONTAINER_KEYS = new Set(
  [
    ...TOKEN_LIST_KEYS,
    'networks', 'chains', 'data', 'result', 'results', 'config', 'configs', 'chain_config', 'chain_configs',
    'network_config', 'network_configs', 'items', 'list', 'payload', 'supported_networks', 'supported_chains',
    'payment_options', 'options', 'response', 'body', 'structured_content', 'content',
  ].map(normKey),
);

/** Chain ids for common network names, used only when an entry has no chain id. */
const KNOWN_NETWORK_CHAIN_IDS: Record<string, number> = {
  hsk: 177, hashkey: 177, hskchain: 177, hashkeychain: 177, hskmainnet: 177, hashkeymainnet: 177,
  hskchainmainnet: 177, hashkeychainmainnet: 177,
  hsktestnet: 133, hashkeytestnet: 133, hskchaintestnet: 133, hashkeychaintestnet: 133,
  sepolia: 11155111, ethereumsepolia: 11155111, ethsepolia: 11155111,
  ethereum: 1, base: 8453, basesepolia: 84532,
};

function chainIdFromNetwork(network: string): number | undefined {
  const caip2 = /^eip155:([0-9]+)$/i.exec(network.trim());
  if (caip2) return asInt(caip2[1]);
  if (/^[0-9]+$/.test(network.trim())) return asInt(network);
  return KNOWN_NETWORK_CHAIN_IDS[normKey(network)];
}

function parseProtocols(value: unknown): HspPaymentProtocol[] {
  const raw: unknown[] = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\s,|/]+/)
      : isRecord(value)
        ? Object.entries(value).filter(([, on]) => on === true).map(([name]) => name)
        : [];
  const out: HspPaymentProtocol[] = [];
  for (const item of raw) {
    const name = typeof item === 'string' ? item : isRecord(item) ? asString(field(item, ['name', 'protocol', 'type'])) : undefined;
    if (!name) continue;
    const k = normKey(name);
    const protocol: HspPaymentProtocol | undefined =
      k === 'eip3009' || k === 'erc3009' || k === 'transferwithauthorization' ? 'eip3009' : k.endsWith('permit2') ? 'permit2' : undefined;
    if (protocol && !out.includes(protocol)) out.push(protocol);
  }
  return out;
}

interface ConfigContext {
  network?: string;
  chainId?: number;
  protocols: HspPaymentProtocol[];
  coin?: string;
}

/** Network name and chain id stated on this record itself (possibly in a nested `network` object). */
function ownNetwork(record: JsonRecord): { network?: string; chainId?: number } {
  let network: string | undefined;
  let chainId = asInt(field(record, CHAIN_ID_KEYS));
  const value = field(record, NETWORK_KEYS);
  if (typeof value === 'string' && value.trim() !== '') network = value.trim();
  else if (typeof value === 'number') chainId ??= asInt(value);
  else if (isRecord(value)) {
    network = asString(field(value, ['name', 'network', 'id', 'network_name']));
    chainId ??= asInt(field(value, CHAIN_ID_KEYS));
  }
  if (network === undefined) {
    // `chain: "sepolia"` names the network; a numeric `chain` was already read as the chain id.
    const chain = field(record, ['chain']);
    if (typeof chain === 'string' && chain.trim() !== '' && asInt(chain) === undefined) network = chain.trim();
  }
  return { network, chainId };
}

function contextOf(record: JsonRecord, inherited: ConfigContext): ConfigContext {
  const own = ownNetwork(record);
  const protocols = parseProtocols(field(record, PROTOCOL_KEYS));
  let { network, chainId } = inherited;
  if (own.network !== undefined) {
    const same = inherited.network !== undefined && own.network.toLowerCase() === inherited.network.toLowerCase();
    network = own.network;
    chainId = own.chainId ?? (same ? inherited.chainId : undefined) ?? chainIdFromNetwork(own.network);
  } else if (own.chainId !== undefined) {
    chainId = own.chainId;
  }
  return { network, chainId, protocols: protocols.length > 0 ? protocols : inherited.protocols, coin: inherited.coin };
}

/** A token address, also from a CAIP-19 asset id such as `eip155:133/erc20:0x…`. */
const asTokenAddress = (value: unknown): Address | undefined => {
  if (typeof value !== 'string') return undefined;
  const caip19 = /^eip155:[0-9]+\/erc20:(0x[0-9a-fA-F]{40})$/i.exec(value.trim());
  return asAddress(caip19 ? caip19[1] : value);
};

const tokenAddressOf = (record: JsonRecord): Address | undefined => {
  for (const key of ADDRESS_KEYS) {
    const address = asTokenAddress(field(record, [key]));
    if (address) return address;
  }
  return undefined;
};

const coinOf = (record: JsonRecord): string | undefined => {
  for (const key of COIN_KEYS) {
    const value = field(record, [key]);
    if (typeof value === 'string' && value.trim() !== '' && !asTokenAddress(value)) return value.trim();
  }
  return undefined;
};

function optionsAt(record: JsonRecord, ctx: ConfigContext): HspPaymentOption[] {
  const contractAddress = tokenAddressOf(record);
  if (!contractAddress) return [];
  const coin = coinOf(record) ?? ctx.coin;
  const decimals = asInt(field(record, DECIMALS_KEYS));
  const { network, chainId } = ctx;
  if (!coin || decimals === undefined || decimals > 255 || !network || !chainId || ctx.protocols.length === 0) return [];
  return ctx.protocols.map((paymentProtocol) => ({ network, chainId, contractAddress, coin, decimals, paymentProtocol }));
}

/** Context for `parent[key]`: map keys can name the network (`{sepolia: {...}}`) or the coin (`{USDC: {...}}`). */
function childContext(key: string, child: unknown, ctx: ConfigContext): ConfigContext {
  const base = { ...ctx, coin: undefined };
  if (!isRecord(child) || CONTAINER_KEYS.has(normKey(key))) return base;
  const hasTokenList = TOKEN_LIST_KEYS.some((k) => {
    const list = field(child, [k]);
    return Array.isArray(list) || isRecord(list);
  });
  if (!hasTokenList && tokenAddressOf(child)) {
    return coinOf(child) ? base : { ...base, coin: key };
  }
  const looksLikeNetwork = hasTokenList || field(child, CHAIN_ID_KEYS) !== undefined;
  if (looksLikeNetwork && ownNetwork(child).network === undefined) {
    return { ...base, network: key, chainId: chainIdFromNetwork(key) };
  }
  return base;
}

function walkConfig(node: unknown, ctx: ConfigContext, out: HspPaymentOption[], depth: number): void {
  if (depth > 12) return;
  if (Array.isArray(node)) {
    for (const item of node) walkConfig(item, ctx, out, depth + 1);
    return;
  }
  if (!isRecord(node)) return;
  const local = contextOf(node, ctx);
  out.push(...optionsAt(node, local));
  for (const [key, child] of Object.entries(node)) {
    if (isRecord(child) || Array.isArray(child)) walkConfig(child, childContext(key, child, local), out, depth + 1);
  }
}

/**
 * Payment options from a `get_chain_config` result (raw MCP result, JSON text or object).
 * Accepts networks with nested token lists, flat token lists carrying network fields, and
 * maps keyed by network or coin name, in snake_case or camelCase. Entries missing a network,
 * chain id, token address, coin, decimals or payment protocol are skipped; returns [] when
 * nothing usable is found. Throws only for an MCP error result or text that is not JSON.
 */
export function parseChainConfig(raw: unknown): HspPaymentOption[] {
  const data = unwrapLoose(raw, 'get_chain_config');
  const found: HspPaymentOption[] = [];
  walkConfig(data, { protocols: [] }, found, 0);
  const seen = new Set<string>();
  return found.filter((o) => {
    const key = `${o.chainId}:${o.contractAddress.toLowerCase()}:${o.paymentProtocol}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const isUsdc = (coin: string): boolean => /^usdc\b/i.test(coin.trim());

const describeOption = (o: HspPaymentOption): string => `${o.coin} on ${o.network} (${o.chainId}, ${o.paymentProtocol})`;

/**
 * Choose where to pay. `prefer` fields filter the options (throws if nothing matches);
 * then the order is HSK Chain testnet (133) USDC, else the first USDC, else the first option.
 * For the chosen token, EIP-3009 wins over Permit2 when both are offered (no approval needed).
 */
export function pickPaymentOption(options: readonly HspPaymentOption[], prefer: PaymentPreference = {}): HspPaymentOption {
  if (options.length === 0) throw new Error('HSP offered no payment options (check get_chain_config)');
  let candidates = [...options];
  const wanted: string[] = [];
  if (prefer.network !== undefined && prefer.network.trim() !== '') {
    const network = prefer.network.trim().toLowerCase();
    candidates = candidates.filter((o) => o.network.toLowerCase() === network || String(o.chainId) === network);
    wanted.push(`network ${prefer.network}`);
  }
  if (prefer.chainId !== undefined) {
    candidates = candidates.filter((o) => o.chainId === prefer.chainId);
    wanted.push(`chain ${prefer.chainId}`);
  }
  if (prefer.coin !== undefined && prefer.coin.trim() !== '') {
    const coin = prefer.coin.trim().toLowerCase();
    candidates = candidates.filter((o) => o.coin.toLowerCase() === coin);
    wanted.push(`coin ${prefer.coin}`);
  }
  if (candidates.length === 0) {
    throw new Error(`HSP offers nothing for ${wanted.join(', ')}; offered: ${options.map(describeOption).join('; ')}`);
  }
  const choice =
    candidates.find((o) => o.chainId === hskTestnet.id && isUsdc(o.coin)) ??
    candidates.find((o) => isUsdc(o.coin)) ??
    candidates[0]!;
  return (
    candidates.find(
      (o) =>
        o.paymentProtocol === 'eip3009' &&
        o.chainId === choice.chainId &&
        o.contractAddress.toLowerCase() === choice.contractAddress.toLowerCase(),
    ) ?? choice
  );
}

// ---------------------------------------------------------------------------
// create_order
// ---------------------------------------------------------------------------

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const randomHex = (bytes: number): string =>
  bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(bytes))).slice(2);

/** RFC 3339 UTC without fractional seconds, e.g. 2026-11-22T10:00:00Z. */
const rfc3339 = (unixSeconds: number): string => new Date(unixSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** `${merchant}: ${purpose}`, cut to at most 120 UTF-16 units without splitting a character. */
function displayLabel(merchant: string, purpose: string): string {
  const full = `${merchant}: ${purpose}`;
  if (full.length <= MAX_DISPLAY_LABEL_LENGTH) return full;
  let out = '';
  for (const ch of full) {
    if (out.length + ch.length > MAX_DISPLAY_LABEL_LENGTH) break;
    out += ch;
  }
  return out.trimEnd();
}

/**
 * The cart mandate for `create_order` (PROTOCOL §2). Ids are `nod-<first 16 hex of termsHash>-<8 random hex>`
 * and `nodpr-…`; `cart_expiry` is min(terms.expiry, now + 2h). Throws on invalid or expired terms,
 * a termsHash that does not match them, or an incomplete payment option.
 */
export function buildCartMandate(input: BuildCartMandateInput): CartMandate {
  const terms = parseTerms(input.terms);
  const termsHash = hashTerms(terms);
  if (typeof input.termsHash !== 'string' || input.termsHash.toLowerCase() !== termsHash) {
    throw new Error(`buildCartMandate: termsHash ${input.termsHash} does not match the terms (${termsHash})`);
  }
  if (typeof input.merchantName !== 'string' || input.merchantName.trim() === '') {
    throw new Error('buildCartMandate: merchantName (NOD_MERCHANT_NAME) is required');
  }
  const { option } = input;
  const contractAddress = asAddress(option?.contractAddress);
  if (!option || !contractAddress || !option.network || !option.coin || !Number.isSafeInteger(option.chainId) || option.chainId <= 0) {
    throw new Error(`buildCartMandate: incomplete payment option ${preview(option)}`);
  }
  const now = input.now ?? nowSeconds();
  if (isExpired(terms, now)) throw new Error('buildCartMandate: the terms have expired');

  const short = termsHash.slice(2, 18);
  const amount: HspAmount = { currency: 'USD', value: terms.amountUsd };
  return {
    contents: {
      id: `nod-${short}-${randomHex(4)}`,
      user_cart_confirmation_required: true,
      cart_expiry: rfc3339(Math.min(terms.expiry, now + MAX_CART_TTL_SEC)),
      merchant_name: input.merchantName,
      payment_request: {
        method_data: [
          {
            supported_methods: X402_METHOD,
            data: {
              x402Version: 2,
              network: option.network,
              chain_id: option.chainId,
              contract_address: contractAddress,
              pay_to: terms.payTo,
              coin: option.coin,
            },
          },
        ],
        details: {
          id: `nodpr-${short}-${randomHex(4)}`,
          display_items: [{ label: displayLabel(terms.merchant, terms.purpose), amount: { ...amount } }],
          total: { label: 'Total', amount: { ...amount } },
        },
      },
    },
  };
}

/**
 * `create_order` result → flow id, payment request id and (if given) the HSP payment page.
 * When HSP does not echo the payment request id, the cart's `details.id` is used.
 */
export function parseCreateOrderResult(raw: unknown, cart?: CartMandate): HspOrder {
  const data = unwrapLoose(raw, 'create_order');
  const flow = findField(data, ['flow']);
  const flowId = asString(findField(data, ['flow_id'])) ?? (isRecord(flow) ? asString(field(flow, ['id', 'flow_id'])) : undefined);
  if (!flowId) throw new Error(`create_order result has no flow_id: ${preview(data)}`);
  const paymentRequestId =
    asString(findField(data, ['payment_request_id'])) ?? cart?.contents.payment_request.details.id;
  if (!paymentRequestId) throw new Error(`create_order result has no payment_request_id: ${preview(data)}`);
  const paymentUrl = asString(findField(data, ['payment_url', 'checkout_url', 'pay_url', 'payment_link', 'cashier_url']));
  return paymentUrl ? { flowId, paymentRequestId, paymentUrl } : { flowId, paymentRequestId };
}

// ---------------------------------------------------------------------------
// prepare_payment / finalize_payment
// ---------------------------------------------------------------------------

const EIP712_KEYS = ['eip712', 'typed_data', 'eip712_typed_data', 'eip712_data'];

function parseEip712(value: unknown): HspEip712 | undefined {
  let v = value;
  if (typeof v === 'string') {
    try {
      v = parseJsonText(v);
    } catch {
      return undefined;
    }
  }
  if (!isRecord(v)) return undefined;
  const { domain, types, primaryType, message } = v;
  if (!isRecord(domain) || !isRecord(types) || typeof primaryType !== 'string' || !isRecord(message)) return undefined;
  return v as unknown as HspEip712;
}

/**
 * `prepare_payment` result → the EIP-712 payload to sign, amounts and the opaque values that
 * `finalize_payment` needs unchanged. Throws when eip712 or an opaque field is missing.
 */
export function parsePrepareResult(raw: unknown): HspPrepared {
  const data = unwrapLoose(raw, 'prepare_payment');
  const holder = findHolder(data, EIP712_KEYS);
  const eip712 = holder ? parseEip712(field(holder, EIP712_KEYS)) : undefined;
  if (!eip712) {
    throw new Error(`prepare_payment result has no usable eip712 (domain, types, primaryType, message): ${preview(data)}`);
  }
  const lookup = (keys: readonly string[]): unknown => (holder ? field(holder, keys) : undefined) ?? findField(data, keys);

  const opaque = {
    payment_payload: lookup(['payment_payload']),
    payment_mandate_contents: lookup(['payment_mandate_contents']),
    cart_hash: lookup(['cart_hash']),
  };
  const missing = Object.entries(opaque).filter(([, v]) => v === undefined).map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`prepare_payment result is missing ${missing.join(', ')}: ${preview(data)}`);
  }

  const message = eip712.message;
  const witness = isRecord(message.witness) ? message.witness : {};
  const permitted = isRecord(message.permitted) ? message.permitted : {};
  const tokenTotalRaw =
    asBigInt(lookup(['token_total_raw', 'total_raw', 'token_amount_raw', 'amount_raw'])) ??
    asBigInt(message.value) ??
    asBigInt(permitted.amount);
  if (tokenTotalRaw === undefined) {
    throw new Error(`prepare_payment result has no token_total_raw: ${preview(data)}`);
  }

  const result: HspPrepared = { eip712, tokenTotalRaw, opaque };
  const chainId = asInt(eip712.domain.chainId);
  if (chainId !== undefined) result.chainId = chainId;
  const quoteExpiresAt =
    asUnixSeconds(lookup(['quote_expires_at', 'quote_expiry', 'quote_expiration', 'expires_at'])) ??
    asUnixSeconds(message.validBefore) ??
    asUnixSeconds(message.deadline);
  if (quoteExpiresAt !== undefined) result.quoteExpiresAt = quoteExpiresAt;
  const payTo = asAddress(lookup(['pay_to', 'to_pay_address'])) ?? asAddress(message.to) ?? asAddress(witness.to);
  if (payTo) result.payTo = payTo;
  const payer = asAddress(lookup(['payer', 'payer_address'])) ?? asAddress(message.from);
  if (payer) result.payer = payer;
  const paymentRequestId = asString(lookup(['payment_request_id']));
  if (paymentRequestId) result.paymentRequestId = paymentRequestId;
  return result;
}

/** `finalize_payment` result → `payment_mandate_json`, which goes unchanged to `submit_payment`. */
export function parseFinalizeResult(raw: unknown): { paymentMandateJson: unknown } {
  const data = unwrapLoose(raw, 'finalize_payment');
  const paymentMandateJson = findField(data, ['payment_mandate_json']);
  if (paymentMandateJson === undefined) {
    throw new Error(`finalize_payment result has no payment_mandate_json: ${preview(data)}`);
  }
  return { paymentMandateJson };
}

// ---------------------------------------------------------------------------
// query_payment
// ---------------------------------------------------------------------------

/**
 * `query_payment` result → status (with its outcome), settlement tx hash (payment.tx_signature),
 * payer, payee (payment.to_pay_address), attribution_verified and status_reason.
 * Throws when there is no status.
 */
export function parseQueryResult(raw: unknown): HspPaymentStatus {
  const data = unwrapLoose(raw, 'query_payment');
  const paymentValue = findField(data, ['payment']);
  const payment = isRecord(paymentValue) ? paymentValue : isRecord(data) ? data : {};
  const lookup = (keys: readonly string[]): unknown => field(payment, keys) ?? findField(data, keys);

  const status = asString(field(payment, ['status', 'payment_status', 'state'])) ?? asString(findField(data, ['payment_status', 'status', 'state']));
  if (!status) throw new Error(`query_payment result has no status: ${preview(data)}`);

  const result: HspPaymentStatus = { status, outcome: hspOutcome(status) };
  const txHash = asHash(lookup(['tx_signature', 'tx_hash', 'transaction_hash', 'settlement_tx']));
  if (txHash) result.txHash = txHash;
  const network = asString(field(payment, ['network'])) ?? asString(findField(data, ['network']));
  if (network) result.network = network;
  const payer = asAddress(lookup(['payer_address', 'payer']));
  if (payer) result.payer = payer;
  const payTo = asAddress(lookup(['to_pay_address', 'pay_to']));
  if (payTo) result.payTo = payTo;
  const attributionVerified = asBoolean(findField(data, ['attribution_verified']));
  if (attributionVerified !== undefined) result.attributionVerified = attributionVerified;
  const statusReason = asString(lookup(['status_reason', 'failure_reason', 'reason']));
  if (statusReason) result.statusReason = statusReason;
  return result;
}
