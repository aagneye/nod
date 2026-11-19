import { encodeCashAddress, hash160, hexToBin } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { MAX_BATCH, MAX_PURPOSE_LENGTH } from '../src/constants.js';
import {
  buildRequestUrl,
  canonicalize,
  createRequest,
  decodeLink,
  encodeLink,
  generateAgentKey,
  hashBatch,
  hashRequest,
  isExpired,
  parseRequest,
  verifyRequest,
} from '../src/request.js';
import type { NodRequest, SignedNodRequest } from '../src/types.js';

const addressFor = (prefix: 'bitcoincash' | 'bchtest', type: 'p2pkh' | 'p2pkhWithTokens' = 'p2pkh') => {
  const { publicKey } = generateAgentKey();
  return encodeCashAddress({ prefix, type, payload: hash160(hexToBin(publicKey)) }).address;
};

const vendor = addressFor('bchtest');
const buyer = addressFor('bchtest');
const FAR_FUTURE = 4_000_000_000;

const fields = {
  agentName: 'research-bot',
  vendor,
  amount: { sats: 2500 },
  purpose: '1 call to weather API',
  expiry: FAR_FUTURE,
};

const baseRequest = (): NodRequest => ({
  v: 1,
  id: '00112233445566778899aabbccddeeff',
  agent: generateAgentKey().publicKey,
  agentName: 'research-bot',
  vendor,
  amount: { sats: 2500 },
  purpose: 'test',
  expiry: FAR_FUTURE,
});

describe('canonicalize / hashRequest', () => {
  it('is stable regardless of key order', () => {
    const a = baseRequest();
    const reversed = Object.fromEntries(Object.entries(a).reverse()) as unknown as NodRequest;
    const tokenA: NodRequest = { ...a, amount: { token: 'ab'.repeat(32), units: '10' } };
    const tokenB: NodRequest = { ...a, amount: { units: '10', token: 'ab'.repeat(32) } };
    expect(canonicalize(reversed)).toBe(canonicalize(a));
    expect(canonicalize(tokenA)).toBe(canonicalize(tokenB));
    expect(canonicalize(a)).not.toMatch(/\s/);
    expect(Object.keys(JSON.parse(canonicalize(a)))).toEqual(Object.keys(JSON.parse(canonicalize(a))).sort());
  });

  it('omits buyer when undefined', () => {
    const a = baseRequest();
    expect(canonicalize({ ...a, buyer: undefined })).toBe(canonicalize(a));
    expect(canonicalize({ ...a, buyer })).toContain('"buyer"');
  });

  it('produces a stable 32-byte hash', () => {
    const a = baseRequest();
    const h1 = hashRequest(a);
    const h2 = hashRequest(JSON.parse(JSON.stringify(a)));
    expect(h1).toHaveLength(32);
    expect(h2).toEqual(h1);
    expect(hashRequest({ ...a, purpose: 'other' })).not.toEqual(h1);
  });
});

describe('sign / verify', () => {
  const key = generateAgentKey();
  const signed = createRequest(fields, key.privateKey);

  it('fills v, id and agent', () => {
    expect(signed.req.v).toBe(1);
    expect(signed.req.id).toMatch(/^[0-9a-f]{32}$/);
    expect(signed.req.agent).toBe(key.publicKey);
    expect(signed.sig).toMatch(/^[0-9a-f]{128}$/);
    expect('buyer' in signed.req).toBe(false);
    expect(createRequest(fields, key.privateKey).req.id).not.toBe(signed.req.id);
    expect(createRequest({ ...fields, id: 'ff'.repeat(16) }, key.privateKey).req.id).toBe('ff'.repeat(16));
  });

  it('verifies a valid signature', () => {
    expect(verifyRequest(signed)).toBe(true);
    expect(verifyRequest(createRequest({ ...fields, buyer }, key.privateKey))).toBe(true);
  });

  it('rejects tampered fields', () => {
    expect(verifyRequest({ ...signed, req: { ...signed.req, amount: { sats: 2501 } } })).toBe(false);
    expect(verifyRequest({ ...signed, req: { ...signed.req, vendor: addressFor('bchtest') } })).toBe(false);
    expect(verifyRequest({ ...signed, req: { ...signed.req, purpose: 'something else' } })).toBe(false);
    expect(verifyRequest({ ...signed, req: { ...signed.req, buyer } })).toBe(false);
  });

  it('rejects the wrong public key', () => {
    const other = generateAgentKey();
    expect(verifyRequest({ ...signed, req: { ...signed.req, agent: other.publicKey } })).toBe(false);
  });

  it('rejects a malformed signature without throwing', () => {
    expect(verifyRequest({ ...signed, sig: 'zz' })).toBe(false);
    expect(verifyRequest({ ...signed, sig: '00'.repeat(64) })).toBe(false);
  });

  it('throws when creating an invalid request', () => {
    expect(() => createRequest({ ...fields, amount: { sats: 1 } }, key.privateKey)).toThrow(/amount/);
  });
});

describe('isExpired', () => {
  it('compares against the expiry', () => {
    const req = baseRequest();
    expect(isExpired(req, req.expiry - 1)).toBe(false);
    expect(isExpired(req, req.expiry)).toBe(false);
    expect(isExpired(req, req.expiry + 1)).toBe(true);
    expect(isExpired({ ...req, expiry: 1 })).toBe(true);
    expect(isExpired(req)).toBe(false);
  });
});

describe('links', () => {
  const key = generateAgentKey();

  it('round-trips', () => {
    const signed = createRequest({ ...fields, buyer, purpose: 'café ☕ / + ?' }, key.privateKey);
    const payload = encodeLink(signed);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    const decoded = decodeLink(payload);
    expect(decoded.signed).toEqual(signed);
    expect(decoded.valid).toBe(true);
    expect(decoded.expired).toBe(false);
  });

  it('reports expired requests', () => {
    const signed = createRequest({ ...fields, expiry: 1 }, key.privateKey);
    const decoded = decodeLink(encodeLink(signed));
    expect(decoded.valid).toBe(true);
    expect(decoded.expired).toBe(true);
  });

  it('reports a bad signature as valid:false', () => {
    const signed = createRequest(fields, key.privateKey);
    const forged: SignedNodRequest = { ...signed, req: { ...signed.req, amount: { sats: 999999 } } };
    expect(decodeLink(encodeLink(forged)).valid).toBe(false);
  });

  it('throws on garbage payloads', () => {
    expect(() => decodeLink('not a payload!')).toThrow();
    expect(() => decodeLink('')).toThrow();
    expect(() => decodeLink(btoa('{"hello":1}').replace(/=+$/, ''))).toThrow();
  });

  it('builds a request URL', () => {
    const signed = createRequest(fields, key.privateKey);
    expect(buildRequestUrl('https://nod.cash/', signed)).toBe(`https://nod.cash/r#${encodeLink(signed)}`);
    expect(buildRequestUrl('https://nod.cash', signed)).toBe(`https://nod.cash/r#${encodeLink(signed)}`);
  });
});

describe('parseRequest', () => {
  it('accepts valid sats and token requests', () => {
    const plain = baseRequest();
    expect(parseRequest(plain)).toEqual(plain);
    expect(parseRequest({ ...plain, buyer })).toEqual({ ...plain, buyer });
    const tokenVendor = addressFor('bitcoincash', 'p2pkhWithTokens');
    const req = { ...baseRequest(), vendor: tokenVendor, amount: { token: 'ab'.repeat(32), units: '1000000' } };
    expect(parseRequest(req).amount).toEqual({ token: 'ab'.repeat(32), units: '1000000' });
  });

  it('rejects a bad vendor', () => {
    const v = vendor;
    for (const bad of ['', 'hello', v.slice(0, -1) + (v.endsWith('q') ? 'p' : 'q'), v.split(':')[1], v.toUpperCase()]) {
      expect(() => parseRequest({ ...baseRequest(), vendor: bad })).toThrow(/vendor/);
    }
    expect(() => parseRequest({ ...baseRequest(), buyer: 'nope' })).toThrow(/buyer/);
  });

  it('rejects bad amounts', () => {
    const bad: unknown[] = [
      { sats: 0 },
      { sats: -5 },
      { sats: 545 },
      { sats: 1.5 },
      { sats: '2500' },
      { sats: Number.MAX_SAFE_INTEGER + 1 },
      { token: 'ab'.repeat(32), units: '0' },
      { token: 'ab'.repeat(32), units: '-1' },
      { token: 'ab'.repeat(32), units: '1.5' },
      { token: 'AB'.repeat(32), units: '1' },
      { token: 'ab', units: '1' },
      { token: 'ab'.repeat(32), units: 10 },
      { sats: 1000, token: 'ab'.repeat(32), units: '1' },
      {},
    ];
    for (const amount of bad) {
      expect(() => parseRequest({ ...baseRequest(), amount }), JSON.stringify(amount)).toThrow(/amount/);
    }
  });

  it('rejects a purpose that is too long or empty', () => {
    expect(() => parseRequest({ ...baseRequest(), purpose: 'x'.repeat(MAX_PURPOSE_LENGTH + 1) })).toThrow(/purpose/);
    expect(() => parseRequest({ ...baseRequest(), purpose: '' })).toThrow(/purpose/);
    expect(parseRequest({ ...baseRequest(), purpose: 'x'.repeat(MAX_PURPOSE_LENGTH) }).purpose).toHaveLength(
      MAX_PURPOSE_LENGTH,
    );
  });

  it('rejects other malformed fields', () => {
    expect(() => parseRequest({ ...baseRequest(), v: 2 })).toThrow(/v/);
    expect(() => parseRequest({ ...baseRequest(), id: 'ABC' })).toThrow(/id/);
    expect(() => parseRequest({ ...baseRequest(), agent: '04' + 'ab'.repeat(32) })).toThrow(/agent/);
    expect(() => parseRequest({ ...baseRequest(), expiry: 0 })).toThrow(/expiry/);
    expect(() => parseRequest({ ...baseRequest(), extra: 1 })).toThrow();
    expect(() => parseRequest(null)).toThrow(/Invalid Nod request/);
  });
});

describe('hashBatch', () => {
  const hashes = Array.from({ length: 5 }, () => hashRequest(createRequest(fields, generateAgentKey().privateKey).req));

  it('is order independent and 32 bytes', () => {
    const h = hashBatch(hashes);
    expect(h).toHaveLength(32);
    expect(hashBatch([...hashes].reverse())).toEqual(h);
    expect(hashBatch([hashes[2]!, hashes[0]!, hashes[4]!, hashes[1]!, hashes[3]!])).toEqual(h);
    expect(hashBatch(hashes.slice(0, 4))).not.toEqual(h);
  });

  it('rejects empty, oversized, duplicate and wrong-length input', () => {
    expect(() => hashBatch([])).toThrow(/empty/);
    const many = Array.from({ length: MAX_BATCH + 1 }, (_, i) => {
      const b = new Uint8Array(32);
      b[0] = i;
      return b;
    });
    expect(() => hashBatch(many)).toThrow(/max/);
    expect(hashBatch(many.slice(0, MAX_BATCH))).toHaveLength(32);
    expect(() => hashBatch([hashes[0]!, hashes[0]!])).toThrow(/duplicate/);
    expect(() => hashBatch([new Uint8Array(31)])).toThrow(/32 bytes/);
  });
});
