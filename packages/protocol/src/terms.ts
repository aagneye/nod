/**
 * Nod terms v2 (PROTOCOL §1): what a receiving agent asks for, signed with EIP-712,
 * and the `<app>/r#<payload>` links that carry them.
 * Runs in browsers and Node: randomness comes from globalThis.crypto, base64 from btoa/atob.
 */
import { z } from 'zod';
import {
  bytesToHex,
  getAddress,
  hashTypedData,
  isAddress,
  recoverTypedDataAddress,
  zeroAddress,
  type Address,
  type Hex,
  type LocalAccount,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  DEFAULT_TERMS_TTL_SEC,
  MAX_AMOUNT_USD,
  MAX_MERCHANT_LENGTH,
  MAX_PURPOSE_LENGTH,
  NOD_VERSION,
} from './constants.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NodTerms {
  v: 2;
  /** bytes16: 0x + 32 hex chars, random per request. */
  id: Hex;
  /** 1-64 chars, shown to the payer. */
  merchant: string;
  /** Recipient address (checksummed). */
  payTo: Address;
  /** Decimal string > 0, at most 2 decimals, at most "10000.00". */
  amountUsd: string;
  /** 1-140 chars. */
  purpose: string;
  /** Unix seconds. */
  expiry: number;
  /** Address of the agent key that signs the terms (checksummed). */
  agent: Address;
}

export interface SignedTerms {
  terms: NodTerms;
  /** 65-byte EIP-712 signature by `terms.agent`. */
  sig: Hex;
}

// ---------------------------------------------------------------------------
// EIP-712
// ---------------------------------------------------------------------------

/** Terms are network-independent, so the domain has no chainId. */
export const TERMS_DOMAIN = { name: 'Nod', version: '2' } as const;

export const TERMS_TYPES = {
  Terms: [
    { name: 'v', type: 'uint8' },
    { name: 'id', type: 'bytes16' },
    { name: 'merchant', type: 'string' },
    { name: 'payTo', type: 'address' },
    { name: 'amountUsd', type: 'string' },
    { name: 'purpose', type: 'string' },
    { name: 'expiry', type: 'uint64' },
    { name: 'agent', type: 'address' },
  ],
} as const;

export const TERMS_PRIMARY_TYPE = 'Terms';

/** The full EIP-712 definition for these terms, ready for any viem signer or wallet. */
export function termsTypedData(terms: NodTerms) {
  return {
    domain: TERMS_DOMAIN,
    types: TERMS_TYPES,
    primaryType: TERMS_PRIMARY_TYPE,
    message: {
      v: terms.v,
      id: terms.id,
      merchant: terms.merchant,
      payTo: terms.payTo,
      amountUsd: terms.amountUsd,
      purpose: terms.purpose,
      expiry: BigInt(terms.expiry),
      agent: terms.agent,
    },
  } as const;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const AMOUNT_USD_RE = /^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/;
const MAX_AMOUNT_CENTS = usdToRaw(MAX_AMOUNT_USD, 2);

const checksummedAddress = z
  .string()
  .refine((value) => isAddress(value, { strict: false }) && getAddress(value) === value, {
    message: 'must be an EIP-55 checksummed address',
  })
  .transform((value) => value as Address);

const amountUsdSchema = z
  .string()
  .regex(AMOUNT_USD_RE, 'must be a decimal string with at most 2 decimals, like "12.50"')
  .refine(
    (value) => {
      if (!AMOUNT_USD_RE.test(value)) return true; // reported by the regex check
      const cents = usdToRaw(value, 2);
      return cents > 0n && cents <= MAX_AMOUNT_CENTS;
    },
    { message: `must be more than 0 and at most ${MAX_AMOUNT_USD}` },
  );

export const termsSchema = z.strictObject({
  v: z.literal(NOD_VERSION),
  id: z
    .string()
    .regex(/^0x[0-9a-fA-F]{32}$/, 'must be 0x followed by 32 hex characters (bytes16)')
    .transform((value) => value as Hex),
  merchant: z
    .string()
    .min(1, 'must not be empty')
    .max(MAX_MERCHANT_LENGTH, `must be at most ${MAX_MERCHANT_LENGTH} characters`),
  payTo: checksummedAddress,
  amountUsd: amountUsdSchema,
  purpose: z
    .string()
    .min(1, 'must not be empty')
    .max(MAX_PURPOSE_LENGTH, `must be at most ${MAX_PURPOSE_LENGTH} characters`),
  expiry: z.number().int('must be whole unix seconds').positive('must be unix seconds'),
  agent: checksummedAddress,
});

export const signedTermsSchema = z.strictObject({
  terms: termsSchema,
  sig: z
    .string()
    .regex(/^0x[0-9a-fA-F]{130}$/, 'must be a 65-byte signature (0x followed by 130 hex characters)')
    .transform((value) => value as Hex),
});

const formatIssues = (error: z.ZodError): string =>
  error.issues.map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`).join('; ');

const errorMessage = (error: unknown): string =>
  error instanceof Error ? ((error as { shortMessage?: string }).shortMessage ?? error.message) : String(error);

/** Field order of the spec; used for hashing inputs and link JSON. */
const orderTerms = (t: NodTerms): NodTerms => ({
  v: t.v,
  id: t.id,
  merchant: t.merchant,
  payTo: t.payTo,
  amountUsd: t.amountUsd,
  purpose: t.purpose,
  expiry: t.expiry,
  agent: t.agent,
});

/** Validate unknown input as NodTerms (PROTOCOL §1). Throws an Error listing every problem. */
export function parseTerms(input: unknown): NodTerms {
  const result = termsSchema.safeParse(input);
  if (!result.success) throw new Error(`Invalid Nod terms: ${formatIssues(result.error)}`);
  return orderTerms(result.data);
}

/** Validate unknown input as SignedTerms (shape only; use verifyTerms for the signature). */
export function parseSignedTerms(input: unknown): SignedTerms {
  const result = signedTermsSchema.safeParse(input);
  if (!result.success) throw new Error(`Invalid signed Nod terms: ${formatIssues(result.error)}`);
  return { terms: orderTerms(result.data.terms), sig: result.data.sig };
}

// ---------------------------------------------------------------------------
// Ids, hashing, signing, verification
// ---------------------------------------------------------------------------

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/** A random bytes16 terms id (0x + 32 lowercase hex chars). */
export function newTermsId(): Hex {
  return bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
}

/** EIP-712 hash of valid terms (bytes32). Throws on invalid terms. */
export function hashTerms(terms: NodTerms): Hex {
  return hashTypedData(termsTypedData(parseTerms(terms)));
}

export interface CreateTermsInput {
  merchant: string;
  /** Recipient address: lowercase or EIP-55 checksummed. Stored checksummed. */
  payTo: string;
  amountUsd: string;
  purpose: string;
  /** Seconds from now until the terms expire (default DEFAULT_TERMS_TTL_SEC). */
  expiresInSec?: number;
  /** Absolute expiry in unix seconds. Pass this or `expiresInSec`, not both. */
  expiry?: number;
  /** Terms id; random by default. */
  id?: Hex;
}

/** The agent key: a viem local account (e.g. privateKeyToAccount) or a raw private key. */
export type TermsSigner = LocalAccount | Hex;

/**
 * Build, validate and sign terms. `v` and `agent` (the signer's address) are filled in.
 * Throws when a field is invalid or the expiry is not in the future.
 */
export async function createTerms(input: CreateTermsInput, signer: TermsSigner): Promise<SignedTerms> {
  const account = typeof signer === 'string' ? privateKeyToAccount(signer) : signer;
  if (input.expiresInSec !== undefined && input.expiry !== undefined) {
    throw new Error('createTerms: pass expiresInSec or expiry, not both');
  }
  const now = nowSeconds();
  let expiry: number;
  if (input.expiry !== undefined) {
    expiry = input.expiry;
  } else {
    const ttl = input.expiresInSec ?? DEFAULT_TERMS_TTL_SEC;
    if (!Number.isSafeInteger(ttl) || ttl <= 0) {
      throw new Error(`createTerms: expiresInSec must be a positive whole number of seconds, got ${ttl}`);
    }
    expiry = now + ttl;
  }
  if (typeof expiry === 'number' && expiry <= now) {
    throw new Error(`createTerms: expiry ${expiry} is not in the future`);
  }

  let payTo: unknown = input.payTo;
  if (typeof payTo === 'string' && isAddress(payTo, { strict: false })) {
    if (!isAddress(payTo)) {
      throw new Error(`createTerms: payTo ${payTo} has an invalid EIP-55 checksum (typo? pass it lowercase to skip the check)`);
    }
    payTo = getAddress(payTo);
  }

  const terms = parseTerms({
    v: NOD_VERSION,
    id: input.id ?? newTermsId(),
    merchant: input.merchant,
    payTo,
    amountUsd: input.amountUsd,
    purpose: input.purpose,
    expiry,
    agent: getAddress(account.address),
  });
  const sig = await account.signTypedData(termsTypedData(terms));
  return { terms, sig };
}

export interface TermsVerification {
  /** Well-formed, signed by `terms.agent`, and not expired. */
  valid: boolean;
  /** Address recovered from `sig`; the zero address when the terms or signature could not be parsed. */
  recovered: Address;
  /** `now` is at or past `terms.expiry` (false when the terms could not be parsed). */
  expired: boolean;
  /** Why the terms are not valid. */
  reason?: string;
}

/**
 * Check signed terms (PROTOCOL §1): every field valid, the signature recovers to `terms.agent`,
 * and `expiry` is in the future. Never throws. `now` is unix seconds.
 */
export async function verifyTerms(signed: unknown, now: number = nowSeconds()): Promise<TermsVerification> {
  const parsed = signedTermsSchema.safeParse(signed);
  if (!parsed.success) {
    return {
      valid: false,
      recovered: zeroAddress,
      expired: false,
      reason: `Invalid terms: ${formatIssues(parsed.error)}`,
    };
  }
  const terms = orderTerms(parsed.data.terms);
  const expired = isExpired(terms, now);
  let recovered: Address;
  try {
    recovered = await recoverTypedDataAddress({ ...termsTypedData(terms), signature: parsed.data.sig });
  } catch (error) {
    return { valid: false, recovered: zeroAddress, expired, reason: `Bad signature: ${errorMessage(error)}` };
  }
  if (recovered.toLowerCase() !== terms.agent.toLowerCase()) {
    return { valid: false, recovered, expired, reason: `Signed by ${recovered}, not by the terms' agent ${terms.agent}` };
  }
  if (expired) {
    return {
      valid: false,
      recovered,
      expired,
      reason: `Expired at ${new Date(terms.expiry * 1000).toISOString()}`,
    };
  }
  return { valid: true, recovered, expired };
}

/** True when `now` (unix seconds, default now) is at or past the expiry. */
export function isExpired(terms: Pick<NodTerms, 'expiry'>, now: number = nowSeconds()): boolean {
  return now >= terms.expiry;
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(text: string): Uint8Array {
  const body = text.replace(/={1,2}$/, '');
  if (!/^[A-Za-z0-9_-]+$/.test(body) || body.length % 4 === 1) {
    throw new Error('payload is not base64url');
  }
  const binary = atob(body.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (body.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Link payload: base64url (no padding) of the UTF-8 JSON `{terms, sig}`. Throws on invalid terms. */
export function encodeLink(signed: SignedTerms): string {
  const { terms, sig } = parseSignedTerms(signed);
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify({ terms, sig })));
}

/**
 * Decode a link: a full `<app>/r#<payload>` URL, `#<payload>`, or the bare payload.
 * Throws when it is not well-formed signed terms. Does not check the signature or expiry:
 * call verifyTerms on the result.
 */
export function decodeLink(payloadOrUrl: string): SignedTerms {
  if (typeof payloadOrUrl !== 'string') throw new Error('Invalid Nod link: expected a string');
  const text = payloadOrUrl.trim();
  const hash = text.indexOf('#');
  const payload = hash >= 0 ? text.slice(hash + 1) : text;
  if (payload === '') throw new Error('Invalid Nod link: no payload');
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(base64UrlDecode(payload)));
  } catch (error) {
    throw new Error(`Invalid Nod link: ${errorMessage(error)}`);
  }
  const result = signedTermsSchema.safeParse(json);
  if (!result.success) throw new Error(`Invalid Nod link: ${formatIssues(result.error)}`);
  return { terms: orderTerms(result.data.terms), sig: result.data.sig };
}

/** `${base}/r#${payload}` (trailing slashes on `base` are ignored). */
export function buildTermsUrl(base: string, signed: SignedTerms): string {
  return `${base.replace(/\/+$/, '')}/r#${encodeLink(signed)}`;
}

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

/**
 * Exact decimal string to token base units, e.g. usdToRaw("12.50", 6) === 12_500_000n.
 * No floats. Throws on anything but a plain non-negative decimal, or when `decimals`
 * cannot represent the amount exactly.
 */
export function usdToRaw(amountUsd: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error(`usdToRaw: decimals must be an integer from 0 to 255, got ${decimals}`);
  }
  const match = typeof amountUsd === 'string' ? /^([0-9]+)(?:\.([0-9]+))?$/.exec(amountUsd) : null;
  if (!match) throw new Error(`usdToRaw: "${amountUsd}" is not a plain decimal amount`);
  const whole = match[1]!;
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  if (fraction.length > decimals) {
    throw new Error(`usdToRaw: ${amountUsd} cannot be represented with ${decimals} decimals`);
  }
  return BigInt(whole + fraction.padEnd(decimals, '0'));
}
