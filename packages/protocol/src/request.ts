/**
 * Nod Request v1: schema, canonical form, hashing, signing and link encoding.
 * Works in browsers and Node 20+ (uses globalThis.crypto and libauth only).
 * Spec: docs/PROTOCOL.md
 */
import {
  base64ToBin,
  binToBase64,
  binToHex,
  decodeCashAddress,
  generatePrivateKey,
  hexToBin,
  secp256k1,
  sha256,
} from '@bitauth/libauth';
import { z } from 'zod';
import { DUST_SATS, MAX_BATCH, MAX_PURPOSE_LENGTH, NOD_VERSION } from './constants.js';
import type { NodRequest, SignedNodRequest } from './types.js';

/** Longest agent label accepted. */
const MAX_AGENT_NAME_LENGTH = 64;
/** Largest fungible token amount allowed by CashTokens (2^63 - 1). */
const MAX_TOKEN_UNITS = 9223372036854775807n;
/** Cashaddr prefixes Nod accepts. */
const ALLOWED_PREFIXES = new Set(['bitcoincash', 'bchtest']);

// ---------------------------------------------------------------------------
// Hex helpers
// ---------------------------------------------------------------------------

export const toHex = (bytes: Uint8Array): string => binToHex(bytes);

export const fromHex = (hex: string): Uint8Array => {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error(`Invalid hex string: ${hex.slice(0, 20)}`);
  }
  return hexToBin(hex);
};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const isValidCashAddress = (address: string): boolean => {
  if (address !== address.toLowerCase()) return false;
  const decoded = decodeCashAddress(address);
  return typeof decoded !== 'string' && ALLOWED_PREFIXES.has(decoded.prefix);
};

const cashAddress = z
  .string()
  .refine(isValidCashAddress, {
    message: 'must be a valid lowercase cashaddr with prefix bitcoincash: or bchtest:',
  });

const satsAmountSchema = z.strictObject({
  sats: z
    .number()
    .int()
    .min(Number(DUST_SATS), `must be at least ${DUST_SATS} sats (dust limit)`)
    .max(Number.MAX_SAFE_INTEGER),
});

const tokenAmountSchema = z.strictObject({
  token: z.string().regex(/^[0-9a-f]{64}$/, 'must be 64 lowercase hex chars'),
  units: z
    .string()
    .regex(/^[1-9][0-9]*$/, 'must be a positive integer string without leading zeros')
    .refine((u) => !/^[0-9]+$/.test(u) || BigInt(u) <= MAX_TOKEN_UNITS, {
      message: 'exceeds the CashTokens maximum',
    }),
});

const requestSchema = z.strictObject({
  v: z.literal(NOD_VERSION),
  id: z.string().regex(/^[0-9a-f]{32}$/, 'must be 32 lowercase hex chars'),
  agent: z
    .string()
    .regex(/^0[23][0-9a-f]{64}$/, 'must be a 66-char lowercase hex compressed public key'),
  agentName: z.string().min(1).max(MAX_AGENT_NAME_LENGTH),
  vendor: cashAddress,
  amount: z.union([satsAmountSchema, tokenAmountSchema]),
  purpose: z.string().min(1).max(MAX_PURPOSE_LENGTH),
  expiry: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  buyer: cashAddress.optional(),
});

const signedSchema = z.strictObject({
  req: z.unknown(),
  sig: z.string().regex(/^[0-9a-f]{128}$/, 'must be 128 lowercase hex chars'),
});

const formatIssues = (error: z.ZodError): string =>
  error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');

/** Validate unknown input as a Nod Request v1. Throws an Error describing every problem. */
export const parseRequest = (input: unknown): NodRequest => {
  const result = requestSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid Nod request: ${formatIssues(result.error)}`);
  }
  const { buyer, ...rest } = result.data;
  return (buyer === undefined ? rest : { ...rest, buyer }) as NodRequest;
};

const parseSigned = (input: unknown): SignedNodRequest => {
  const result = signedSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid signed Nod request: ${formatIssues(result.error)}`);
  }
  return { req: parseRequest(result.data.req), sig: result.data.sig };
};

// ---------------------------------------------------------------------------
// Canonical form and hashing
// ---------------------------------------------------------------------------

const canonicalValue = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('Cannot canonicalize a non-finite number');
    }
    const json = JSON.stringify(value);
    if (json === undefined) throw new Error(`Cannot canonicalize value of type ${typeof value}`);
    return json;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  const entries = Object.keys(value)
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalValue((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(',')}}`;
};

/** JSON with recursively sorted keys, no whitespace, undefined fields (e.g. `buyer`) omitted. */
export const canonicalize = (req: NodRequest): string => canonicalValue(req);

/** sha256 of the UTF-8 canonical JSON (32 bytes). */
export const hashRequest = (req: NodRequest): Uint8Array =>
  sha256.hash(new TextEncoder().encode(canonicalize(req)));

const compareBytes = (a: Uint8Array, b: Uint8Array): number => {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
};

/** sha256 of the request hashes sorted ascending bytewise and concatenated. */
export const hashBatch = (hashes: Uint8Array[]): Uint8Array => {
  if (hashes.length === 0) throw new Error('hashBatch: batch is empty');
  if (hashes.length > MAX_BATCH) {
    throw new Error(`hashBatch: batch has ${hashes.length} requests, max is ${MAX_BATCH}`);
  }
  for (const h of hashes) {
    if (h.length !== 32) throw new Error('hashBatch: every hash must be 32 bytes');
  }
  const sorted = [...hashes].sort(compareBytes);
  for (let i = 1; i < sorted.length; i++) {
    if (compareBytes(sorted[i - 1]!, sorted[i]!) === 0) {
      throw new Error('hashBatch: duplicate request hash in batch');
    }
  }
  const joined = new Uint8Array(sorted.length * 32);
  sorted.forEach((h, i) => joined.set(h, i * 32));
  return sha256.hash(joined);
};

// ---------------------------------------------------------------------------
// Keys, signing, verification
// ---------------------------------------------------------------------------

const randomBytes = (n: number): Uint8Array => globalThis.crypto.getRandomValues(new Uint8Array(n));

const derivePublicKey = (privateKey: Uint8Array): string => {
  const pub = secp256k1.derivePublicKeyCompressed(privateKey);
  if (typeof pub === 'string') throw new Error(`Invalid agent private key: ${pub}`);
  return binToHex(pub);
};

/** New random agent key. `publicKey` is the 66-char compressed hex form used in `NodRequest.agent`. */
export const generateAgentKey = (): { privateKey: Uint8Array; publicKey: string } => {
  const privateKey = generatePrivateKey(() => randomBytes(32));
  return { privateKey, publicKey: derivePublicKey(privateKey) };
};

/** Build, validate and sign a request. `v`, `agent` and (unless given) `id` are filled in. */
export const createRequest = (
  fields: Omit<NodRequest, 'v' | 'id' | 'agent'> & { id?: string },
  agentPrivateKey: Uint8Array,
): SignedNodRequest => {
  const draft: NodRequest = {
    v: NOD_VERSION,
    id: fields.id ?? binToHex(randomBytes(16)),
    agent: derivePublicKey(agentPrivateKey),
    agentName: fields.agentName,
    vendor: fields.vendor,
    amount: fields.amount,
    purpose: fields.purpose,
    expiry: fields.expiry,
    ...(fields.buyer === undefined ? {} : { buyer: fields.buyer }),
  };
  const req = parseRequest(draft);
  const sig = secp256k1.signMessageHashSchnorr(agentPrivateKey, hashRequest(req));
  if (typeof sig === 'string') throw new Error(`Signing failed: ${sig}`);
  return { req, sig: binToHex(sig) };
};

/** True when the request is well-formed and `sig` is the agent's Schnorr signature over its hash. */
export const verifyRequest = (signed: SignedNodRequest): boolean => {
  try {
    const { req, sig } = parseSigned(signed);
    return secp256k1.verifySignatureSchnorr(hexToBin(sig), hexToBin(req.agent), hashRequest(req));
  } catch {
    return false;
  }
};

/** True when `nowSeconds` (default: now) is past the request's expiry. */
export const isExpired = (req: NodRequest, nowSeconds?: number): boolean =>
  (nowSeconds ?? Math.floor(Date.now() / 1000)) > req.expiry;

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

const toBase64Url = (bytes: Uint8Array): string =>
  binToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromBase64Url = (text: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) {
    throw new Error('Invalid link payload: not base64url');
  }
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBin(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
};

/** base64url (no padding) of the UTF-8 JSON `{req, sig}`. */
export const encodeLink = (signed: SignedNodRequest): string =>
  toBase64Url(new TextEncoder().encode(JSON.stringify({ req: signed.req, sig: signed.sig })));

/**
 * Decode a link payload. Throws if the payload is not a well-formed signed request;
 * otherwise reports whether the signature is valid and whether the request has expired.
 */
export const decodeLink = (
  payload: string,
): { signed: SignedNodRequest; valid: boolean; expired: boolean } => {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(payload.trim())));
  } catch (e) {
    throw new Error(`Invalid link payload: ${e instanceof Error ? e.message : String(e)}`);
  }
  const signed = parseSigned(json);
  return { signed, valid: verifyRequest(signed), expired: isExpired(signed.req) };
};

/** `${baseUrl}/r#${payload}` (a trailing slash on baseUrl is ignored). */
export const buildRequestUrl = (baseUrl: string, signed: SignedNodRequest): string =>
  `${baseUrl.replace(/\/+$/, '')}/r#${encodeLink(signed)}`;
