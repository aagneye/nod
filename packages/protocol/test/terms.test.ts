import { describe, expect, it } from 'vitest';
import { getAddress, isAddress, keccak256, toBytes, zeroAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  DEFAULT_TERMS_TTL_SEC,
  TERMS_DOMAIN,
  buildTermsUrl,
  createTerms,
  decodeLink,
  encodeLink,
  hashTerms,
  isExpired,
  newTermsId,
  parseSignedTerms,
  parseTerms,
  termsTypedData,
  usdToRaw,
  verifyTerms,
  type CreateTermsInput,
  type SignedTerms,
} from '../src/index.js';
import { AGENT, AGENT_KEY, FIXED_EXPIRY, FIXED_TERMS, FIXED_TERMS_HASH, OTHER, OTHER_KEY, PAYER, VENDOR } from './fixtures.js';

const input = (overrides: Partial<CreateTermsInput> = {}): CreateTermsInput => ({
  merchant: 'Acme Weather',
  payTo: VENDOR,
  amountUsd: '12.50',
  purpose: '1000 forecast API calls',
  expiresInSec: 600,
  ...overrides,
});

const now = (): number => Math.floor(Date.now() / 1000);

/** base64url JSON → object, without going through decodeLink. */
const rawPayload = (payload: string): unknown =>
  JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));

const toPayload = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

describe('fixtures', () => {
  it('derive the pinned keys and addresses', () => {
    expect(keccak256(toBytes('nod-test-agent'))).toBe(AGENT_KEY);
    expect(privateKeyToAccount(AGENT_KEY).address).toBe(AGENT);
    expect(privateKeyToAccount(OTHER_KEY).address).toBe(OTHER);
    expect(privateKeyToAccount(keccak256(toBytes('nod-test-vendor'))).address).toBe(VENDOR);
    for (const address of [AGENT, OTHER, VENDOR, PAYER]) expect(getAddress(address)).toBe(address);
  });
});

describe('EIP-712 domain and hash', () => {
  it('uses a domain without chainId', () => {
    expect(TERMS_DOMAIN).toEqual({ name: 'Nod', version: '2' });
    expect(termsTypedData(FIXED_TERMS).primaryType).toBe('Terms');
  });

  it('hashTerms is stable for fixed terms', () => {
    expect(hashTerms(FIXED_TERMS)).toBe(FIXED_TERMS_HASH);
  });

  it('hashTerms does not depend on key order', () => {
    const reordered = JSON.parse(JSON.stringify({ ...FIXED_TERMS }, Object.keys(FIXED_TERMS).reverse()));
    expect(hashTerms(reordered)).toBe(FIXED_TERMS_HASH);
  });

  it('hashTerms changes with any field', () => {
    expect(hashTerms({ ...FIXED_TERMS, amountUsd: '12.51' })).not.toBe(FIXED_TERMS_HASH);
    expect(hashTerms({ ...FIXED_TERMS, expiry: FIXED_EXPIRY + 1 })).not.toBe(FIXED_TERMS_HASH);
  });

  it('hashTerms rejects invalid terms', () => {
    expect(() => hashTerms({ ...FIXED_TERMS, amountUsd: '0' })).toThrow(/amountUsd/);
    expect(() => hashTerms({ ...FIXED_TERMS, payTo: VENDOR.toLowerCase() as Hex })).toThrow(/payTo/);
  });
});

describe('createTerms / verifyTerms', () => {
  it('signs terms that verify', async () => {
    const signed = await createTerms(input(), AGENT_KEY);
    expect(signed.terms).toMatchObject({ v: 2, agent: AGENT, payTo: VENDOR, amountUsd: '12.50' });
    expect(signed.terms.id).toMatch(/^0x[0-9a-f]{32}$/);
    expect(signed.sig).toMatch(/^0x[0-9a-f]{130}$/);
    expect(await verifyTerms(signed)).toEqual({ valid: true, recovered: AGENT, expired: false });
  });

  it('accepts a viem account as the signer and fills in agent from it', async () => {
    const signed = await createTerms(input(), privateKeyToAccount(OTHER_KEY));
    expect(signed.terms.agent).toBe(OTHER);
    expect((await verifyTerms(signed)).valid).toBe(true);
  });

  it('produces the pinned hash for fixed inputs', async () => {
    const { terms } = await createTerms(
      { ...input({ expiresInSec: undefined }), id: FIXED_TERMS.id, expiry: FIXED_EXPIRY },
      AGENT_KEY,
    );
    expect(terms).toEqual(FIXED_TERMS);
    expect(hashTerms(terms)).toBe(FIXED_TERMS_HASH);
  });

  it('checksums a lowercase payTo and rejects a bad checksum', async () => {
    const signed = await createTerms(input({ payTo: VENDOR.toLowerCase() }), AGENT_KEY);
    expect(signed.terms.payTo).toBe(VENDOR);
    // Flip the case of the first letter: same address, broken EIP-55 checksum.
    const i = VENDOR.slice(2).search(/[a-fA-F]/) + 2;
    const ch = VENDOR[i]!;
    const badChecksum = VENDOR.slice(0, i) + (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()) + VENDOR.slice(i + 1);
    expect(badChecksum.toLowerCase()).toBe(VENDOR.toLowerCase());
    expect(isAddress(badChecksum)).toBe(false);
    await expect(createTerms(input({ payTo: badChecksum }), AGENT_KEY)).rejects.toThrow(/checksum/);
    await expect(createTerms(input({ payTo: '0x1234' }), AGENT_KEY)).rejects.toThrow(/payTo/);
  });

  it('flags a tampered field', async () => {
    const signed = await createTerms(input(), AGENT_KEY);
    for (const tampered of [
      { ...signed.terms, amountUsd: '1250.00' },
      { ...signed.terms, payTo: OTHER },
      { ...signed.terms, purpose: 'something else' },
      { ...signed.terms, expiry: signed.terms.expiry + 3600 },
    ]) {
      const result = await verifyTerms({ terms: tampered, sig: signed.sig });
      expect(result.valid).toBe(false);
      expect(result.recovered).not.toBe(AGENT);
      expect(result.reason).toMatch(/not by the terms' agent/);
    }
  });

  it('flags terms signed by a key other than terms.agent', async () => {
    const terms = { ...FIXED_TERMS, expiry: now() + 600 };
    const sig = await privateKeyToAccount(OTHER_KEY).signTypedData(termsTypedData(terms));
    const result = await verifyTerms({ terms, sig });
    expect(result).toMatchObject({ valid: false, recovered: OTHER, expired: false });
    expect(result.reason).toContain(OTHER);
  });

  it('handles expiry', async () => {
    const signed = await createTerms(input({ expiresInSec: 60 }), AGENT_KEY);
    const { expiry } = signed.terms;
    expect(expiry - now()).toBeGreaterThanOrEqual(59);
    expect(expiry - now()).toBeLessThanOrEqual(61);
    expect(isExpired(signed.terms, expiry - 1)).toBe(false);
    expect(isExpired(signed.terms, expiry)).toBe(true);
    expect(await verifyTerms(signed, expiry - 1)).toMatchObject({ valid: true, expired: false });
    const late = await verifyTerms(signed, expiry);
    expect(late).toMatchObject({ valid: false, expired: true, recovered: AGENT });
    expect(late.reason).toMatch(/Expired/);
  });

  it('defaults the lifetime and validates expiry options', async () => {
    const signed = await createTerms(input({ expiresInSec: undefined }), AGENT_KEY);
    expect(Math.abs(signed.terms.expiry - (now() + DEFAULT_TERMS_TTL_SEC))).toBeLessThanOrEqual(2);
    await expect(createTerms(input({ expiry: now() + 60 }), AGENT_KEY)).rejects.toThrow(/not both/);
    await expect(createTerms(input({ expiresInSec: 0 }), AGENT_KEY)).rejects.toThrow(/expiresInSec/);
    await expect(createTerms(input({ expiresInSec: 1.5 }), AGENT_KEY)).rejects.toThrow(/expiresInSec/);
    await expect(createTerms(input({ expiresInSec: undefined, expiry: now() - 1 }), AGENT_KEY)).rejects.toThrow(/future/);
    await expect(createTerms(input({ expiresInSec: undefined, expiry: now() + 60.5 }), AGENT_KEY)).rejects.toThrow(/expiry/);
  });

  it('validates amountUsd per the spec', async () => {
    for (const amountUsd of ['0.01', '5', '5.5', '5.50', '0.5', '9999.99', '10000', '10000.0', '10000.00']) {
      expect(parseTerms({ ...FIXED_TERMS, amountUsd }).amountUsd).toBe(amountUsd);
    }
    for (const amountUsd of ['0', '0.00', '0.001', '10000.01', '10001', '1.234', '01', '.5', '5.', '-1', '+1', '1e3', ' 5', '5 ', '', '1,000']) {
      expect(() => parseTerms({ ...FIXED_TERMS, amountUsd }), amountUsd).toThrow(/amountUsd/);
    }
  });

  it('validates lengths and shapes per the spec', () => {
    expect(parseTerms({ ...FIXED_TERMS, merchant: 'm'.repeat(64) }).merchant).toHaveLength(64);
    expect(parseTerms({ ...FIXED_TERMS, purpose: 'p'.repeat(140) }).purpose).toHaveLength(140);
    const bad: Array<[string, Record<string, unknown>]> = [
      ['merchant', { merchant: '' }],
      ['merchant', { merchant: 'm'.repeat(65) }],
      ['purpose', { purpose: '' }],
      ['purpose', { purpose: 'p'.repeat(141) }],
      ['v', { v: 1 }],
      ['id', { id: '0x0123' }],
      ['id', { id: '0123456789abcdef0123456789abcdef' }],
      ['expiry', { expiry: 1.5 }],
      ['expiry', { expiry: '1893456000' }],
      ['expiry', { expiry: -1 }],
      ['agent', { agent: AGENT.toLowerCase() }],
      ['extra', { extra: 'field' }],
    ];
    for (const [label, patch] of bad) {
      expect(() => parseTerms({ ...FIXED_TERMS, ...patch }), label).toThrow(/Invalid Nod terms/);
    }
  });

  it('never throws on garbage and reports why', async () => {
    const signed = await createTerms(input(), AGENT_KEY);
    const cases: unknown[] = [
      undefined,
      {},
      { terms: signed.terms },
      { terms: signed.terms, sig: '0x1234' },
      { terms: { ...signed.terms, payTo: signed.terms.payTo.toLowerCase() }, sig: signed.sig },
      { terms: { ...signed.terms, note: 'unsigned extra' }, sig: signed.sig },
      { ...signed, extra: true },
    ];
    for (const value of cases) {
      const result = await verifyTerms(value);
      expect(result.valid).toBe(false);
      expect(result.recovered).toBe(zeroAddress);
      expect(result.reason).toMatch(/Invalid terms/);
    }
    const garbageSig = await verifyTerms({ terms: signed.terms, sig: `0x${'00'.repeat(65)}` });
    expect(garbageSig.valid).toBe(false);
    expect(garbageSig.reason).toBeTruthy();
  });
});

describe('links', () => {
  it('round-trips through the payload, fragment and full URL', async () => {
    const signed = await createTerms(input(), AGENT_KEY);
    const payload = encodeLink(signed);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    const url = buildTermsUrl('https://nod.example/', signed);
    expect(url).toBe(`https://nod.example/r#${payload}`);
    expect(buildTermsUrl('https://nod.example', signed)).toBe(url);
    for (const form of [payload, `#${payload}`, url, `  ${url}\n`]) {
      expect(decodeLink(form)).toEqual(signed);
    }
    expect((await verifyTerms(decodeLink(url))).valid).toBe(true);
  });

  it('keeps unicode text intact', async () => {
    const signed = await createTerms(input({ merchant: 'Café Ünïcødé ☕', purpose: 'Datos 📈 für 日本' }), AGENT_KEY);
    const decoded = decodeLink(encodeLink(signed));
    expect(decoded).toEqual(signed);
    expect((await verifyTerms(decoded)).valid).toBe(true);
  });

  it('carries expiry as a JSON number and checksummed addresses, in spec field order', async () => {
    const signed = await createTerms(input({ payTo: VENDOR.toLowerCase() }), AGENT_KEY);
    const json = rawPayload(encodeLink(signed)) as SignedTerms;
    expect(Object.keys(json)).toEqual(['terms', 'sig']);
    expect(Object.keys(json.terms)).toEqual(['v', 'id', 'merchant', 'payTo', 'amountUsd', 'purpose', 'expiry', 'agent']);
    expect(typeof json.terms.expiry).toBe('number');
    expect(json.terms.payTo).toBe(VENDOR);
    expect(json.terms.agent).toBe(AGENT);
  });

  it('throws on malformed links', async () => {
    const signed = await createTerms(input(), AGENT_KEY);
    const malformed = [
      '',
      'https://nod.example/r#',
      'not base64!!',
      'abcde',
      toPayload('hello').slice(0, -1) + '*',
      Buffer.from('not json', 'utf8').toString('base64url'),
      Buffer.from([0xff, 0xfe, 0xfd]).toString('base64url'),
      toPayload({ a: 1 }),
      toPayload([signed]),
      toPayload({ ...signed, terms: { ...signed.terms, expiry: String(signed.terms.expiry) } }),
      toPayload({ ...signed, terms: { ...signed.terms, payTo: signed.terms.payTo.toLowerCase() } }),
      toPayload({ ...signed, sig: signed.sig.slice(0, -2) }),
    ];
    for (const link of malformed) {
      expect(() => decodeLink(link), link).toThrow(/Invalid Nod link/);
    }
    expect(() => decodeLink(42 as unknown as string)).toThrow(/Invalid Nod link/);
  });

  it('decodes links whose signature is wrong (verifyTerms catches them)', async () => {
    const signed = await createTerms(input(), AGENT_KEY);
    const forged = { ...signed, terms: { ...signed.terms, amountUsd: '9999.00' } };
    const decoded = decodeLink(toPayload(forged));
    expect(decoded.terms.amountUsd).toBe('9999.00');
    expect((await verifyTerms(decoded)).valid).toBe(false);
  });

  it('refuses to encode invalid terms', () => {
    expect(() => encodeLink({ terms: { ...FIXED_TERMS, purpose: '' }, sig: `0x${'11'.repeat(65)}` })).toThrow(/purpose/);
    expect(parseSignedTerms({ terms: FIXED_TERMS, sig: `0x${'11'.repeat(65)}` }).terms).toEqual(FIXED_TERMS);
  });
});

describe('newTermsId', () => {
  it('is a random bytes16', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newTermsId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^0x[0-9a-f]{32}$/);
  });
});

describe('usdToRaw', () => {
  it('converts exactly', () => {
    expect(usdToRaw('0.01', 6)).toBe(10_000n);
    expect(usdToRaw('0.01', 18)).toBe(10n ** 16n);
    expect(usdToRaw('10000.00', 6)).toBe(10_000_000_000n);
    expect(usdToRaw('10000.00', 18)).toBe(10n ** 22n);
    expect(usdToRaw('12.5', 6)).toBe(12_500_000n);
    expect(usdToRaw('0.29', 6)).toBe(290_000n); // 0.29 * 1e6 is 290000.00000000006 in floats
    expect(usdToRaw('1', 0)).toBe(1n);
    expect(usdToRaw('1.00', 0)).toBe(1n);
    expect(usdToRaw('1.50', 1)).toBe(15n);
    expect(usdToRaw('0', 6)).toBe(0n);
    expect(usdToRaw('0.01', 2)).toBe(1n);
  });

  it('refuses amounts it cannot represent and malformed input', () => {
    expect(() => usdToRaw('0.01', 0)).toThrow(/cannot be represented/);
    expect(() => usdToRaw('0.01', 1)).toThrow(/cannot be represented/);
    for (const bad of ['', '1.', '.5', '-1', '1e3', '1,5', ' 1', 'abc']) {
      expect(() => usdToRaw(bad, 6), bad).toThrow(/plain decimal/);
    }
    for (const decimals of [-1, 1.5, 256, Number.NaN]) {
      expect(() => usdToRaw('1', decimals), String(decimals)).toThrow(/decimals/);
    }
  });
});
