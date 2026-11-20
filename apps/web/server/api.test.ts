import { binToHex, cashAddressToLockingBytecode, encodeTransaction, hexToBin } from '@bitauth/libauth';
import {
  createRequest,
  decodeLink,
  encodeLink,
  encodeMemo,
  generateAgentKey,
  hashRequest,
  type SignedNodRequest,
} from '@nod/protocol';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { handleDemoAgent } from './demoAgent.js';
import { p2pkhAddress } from './env.js';
import { toNodeHandler } from './node-adapter.js';
import { handleVendorBuy, type ConnectedChain } from './vendor.js';

const KEY = '11'.repeat(32);
const VENDOR = 'bchtest:qr4upmst92u7sfm6vqxz29r4ug4rysdpcytc853pps';
const TXID = 'ab'.repeat(32);

const get = (url = 'http://localhost:5173/api/demo-agent', headers: Record<string, string> = { host: 'localhost:5173' }) =>
  new Request(url, { headers });

const post = (body: unknown) =>
  new Request('http://localhost/api/vendor/buy', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

/** A chain that knows exactly the given transactions. */
const fakeChain = (txs: Record<string, string> = {}): ConnectedChain & { disconnect: () => Promise<void> } => ({
  getHistory: async () => [],
  getTransactionHex: async (txid: string) => {
    const hex = txs[txid];
    if (!hex) throw new Error('not found');
    return hex;
  },
  disconnect: vi.fn(async () => undefined),
});

/** A transaction paying `sats` to `vendor` with a single-request memo for `signed`. */
const payingTx = (signed: SignedNodRequest, sats: number, memoFor: SignedNodRequest = signed): string => {
  const vendorLocking = cashAddressToLockingBytecode(signed.req.vendor);
  if (typeof vendorLocking === 'string') throw new Error(vendorLocking);
  return binToHex(
    encodeTransaction({
      version: 2,
      locktime: 0,
      inputs: [
        { outpointIndex: 0, outpointTransactionHash: hexToBin('cd'.repeat(32)), sequenceNumber: 0, unlockingBytecode: new Uint8Array() },
      ],
      outputs: [
        { lockingBytecode: vendorLocking.bytecode, valueSatoshis: BigInt(sats) },
        { lockingBytecode: encodeMemo('single', hashRequest(memoFor.req)), valueSatoshis: 0n },
      ],
    }),
  );
};

const demoSigned = async (env: Record<string, string>): Promise<SignedNodRequest> => {
  const res = await handleDemoAgent(get(), env);
  return ((await res.json()) as { request: SignedNodRequest }).request;
};

const offlineFetch = (async () => {
  throw new Error('offline');
}) as unknown as typeof fetch;

describe('GET /api/demo-agent', () => {
  it('returns a valid, unexpired, signed link with the configured key and vendor', async () => {
    const res = await handleDemoAgent(get(), { NOD_DEMO_AGENT_KEY: KEY, NOD_DEMO_VENDOR: VENDOR, NOD_NETWORK: 'chipnet' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.warning).toBeUndefined();
    expect(body.network).toBe('chipnet');
    const link = body.link as string;
    expect(link.startsWith('http://localhost:5173/r#')).toBe(true);
    const decoded = decodeLink(link.split('#')[1]!);
    expect(decoded.valid).toBe(true);
    expect(decoded.expired).toBe(false);
    expect(decoded.signed.req.vendor).toBe(VENDOR);
    expect(decoded.signed.req.amount).toEqual({ sats: 2000 });
    expect(decoded.signed.req.agentName).toBe('Nod demo agent');
    expect(body.hash).toBe(binToHex(hashRequest(decoded.signed.req)));
    expect(body.expiresAt).toBe(decoded.signed.req.expiry);
  });

  it('uses NOD_PUBLIC_URL, NOD_DEMO_SATS and https for non-local hosts', async () => {
    const res = await handleDemoAgent(get('https://nod.example/api/demo-agent', { host: 'nod.example' }), {
      NOD_DEMO_AGENT_KEY: KEY,
      NOD_DEMO_VENDOR: VENDOR,
      NOD_DEMO_SATS: '1500',
    });
    const body = (await res.json()) as { link: string };
    expect(body.link.startsWith('https://nod.example/r#')).toBe(true);
    expect(decodeLink(body.link.split('#')[1]!).signed.req.amount).toEqual({ sats: 1500 });

    const res2 = await handleDemoAgent(get(), { NOD_DEMO_AGENT_KEY: KEY, NOD_DEMO_VENDOR: VENDOR, NOD_PUBLIC_URL: 'https://nod.app/' });
    expect(((await res2.json()) as { link: string }).link.startsWith('https://nod.app/r#')).toBe(true);
  });

  it('falls back to an ephemeral key and a derived chipnet vendor, with a warning', async () => {
    const res = await handleDemoAgent(get(), {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { warning?: string; network: string; request: SignedNodRequest };
    expect(body.warning).toBe('ephemeral agent key');
    expect(body.network).toBe('chipnet');
    expect(body.request.req.vendor).toBe(p2pkhAddress(body.request.req.agent, 'chipnet'));
  });

  it('refuses mainnet without NOD_DEMO_VENDOR', async () => {
    const res = await handleDemoAgent(get(), { NOD_NETWORK: 'mainnet', NOD_DEMO_AGENT_KEY: KEY });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'NOD_DEMO_VENDOR is not set' });
    const viaVite = await handleDemoAgent(get(), { VITE_NETWORK: 'mainnet' });
    expect(viaVite.status).toBe(500);
  });

  it('rejects a malformed agent key', async () => {
    const res = await handleDemoAgent(get(), { NOD_DEMO_AGENT_KEY: 'zz' });
    expect(res.status).toBe(500);
  });
});

describe('POST /api/vendor/buy', () => {
  const env = { NOD_DEMO_AGENT_KEY: KEY, NOD_DEMO_VENDOR: VENDOR, NOD_NETWORK: 'chipnet' };

  it('400 on garbage bodies', async () => {
    const deps = { env, connectChain: async () => fakeChain() };
    for (const body of ['not json', '[]', {}, { txid: 'xyz' }, { txid: TXID }, { txid: TXID, signed: { req: {}, sig: 'aa' } }]) {
      const res = await handleVendorBuy(post(body), deps);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(typeof ((await res.json()) as { error: string }).error).toBe('string');
    }
  });

  it('400 when the request is for another vendor', async () => {
    const other = createRequest(
      { agentName: 'x', vendor: p2pkhAddress(generateAgentKey().publicKey, 'chipnet'), amount: { sats: 2000 }, purpose: 'p', expiry: 2e9 },
      hexToBin(KEY),
    );
    const res = await handleVendorBuy(post({ txid: TXID, signed: other }), { env, connectChain: async () => fakeChain() });
    expect(res.status).toBe(400);
  });

  it('402 when the transaction is not found (unpaid)', async () => {
    const signed = await demoSigned(env);
    const chain = fakeChain();
    const res = await handleVendorBuy(post({ txid: TXID, signed }), { env, connectChain: async () => chain });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { ok: boolean; reasons: string[] };
    expect(body.ok).toBe(false);
    expect(body.reasons[0]).toMatch(/transaction not found/);
    expect(chain.disconnect).toHaveBeenCalled();
  });

  it('402 on wrong amount or wrong memo', async () => {
    const signed = await demoSigned(env);
    const otherSigned = await demoSigned(env);
    const chain = fakeChain({ [TXID]: payingTx(signed, 1999), ['ef'.repeat(32)]: payingTx(signed, 2000, otherSigned) });
    const r1 = await handleVendorBuy(post({ txid: TXID, signed }), { env, connectChain: async () => chain });
    expect(r1.status).toBe(402);
    expect(((await r1.json()) as { reasons: string[] }).reasons).toContain('amount mismatch');
    const r2 = await handleVendorBuy(post({ txid: 'ef'.repeat(32), signed }), { env, connectChain: async () => chain });
    expect(r2.status).toBe(402);
    expect(((await r2.json()) as { reasons: string[] }).reasons).toContain('memo hash mismatch');
  });

  it('200 with the item when paid (accepts signed or payload), repeatable', async () => {
    const signed = await demoSigned(env);
    const chain = fakeChain({ [TXID]: payingTx(signed, 2000) });
    const deps = { env, connectChain: async () => chain, fetch: offlineFetch };
    for (const body of [{ txid: TXID, signed }, { txid: TXID.toUpperCase(), payload: `http://x/r#${encodeLink(signed)}` }, { txid: TXID, signed }]) {
      const res = await handleVendorBuy(post(body), deps);
      expect(res.status).toBe(200);
      const out = (await res.json()) as { ok: boolean; item: { title: string; body: string; deliveredAt: number } };
      expect(out.ok).toBe(true);
      expect(out.item.title).toMatch(/^Weather report: /);
      expect(out.item.body).toMatch(/cached report/);
      expect(typeof out.item.deliveredAt).toBe('number');
    }
  });

  it('uses the live weather when the fetch works', async () => {
    const signed = await demoSigned(env);
    const fetchStub = (async () =>
      new Response(JSON.stringify({ current: { time: '2026-11-20T10:00', temperature_2m: 17.3, relative_humidity_2m: 60, wind_speed_10m: 9 } }))) as unknown as typeof fetch;
    const res = await handleVendorBuy(post({ txid: TXID, signed }), {
      env,
      connectChain: async () => fakeChain({ [TXID]: payingTx(signed, 2000) }),
      fetch: fetchStub,
    });
    const out = (await res.json()) as { item: { body: string } };
    expect(out.item.body).toMatch(/17\.3 °C/);
  });

  it('500 when no Electrum server answers', async () => {
    const signed = await demoSigned(env);
    const res = await handleVendorBuy(post({ txid: TXID, signed }), {
      env,
      connectChain: async () => {
        throw new Error('Could not connect to any Electrum server');
      },
    });
    expect(res.status).toBe(500);
  });

  it('chipnet without NOD_DEMO_VENDOR accepts the self-vendor of the configured key only', async () => {
    const env2 = { NOD_DEMO_AGENT_KEY: KEY };
    const signed = await demoSigned(env2);
    const chain = fakeChain({ [TXID]: payingTx(signed, 2000) });
    const ok = await handleVendorBuy(post({ txid: TXID, signed }), { env: env2, connectChain: async () => chain, fetch: offlineFetch });
    expect(ok.status).toBe(200);
    const stranger = generateAgentKey();
    const foreign = createRequest(
      { agentName: 'x', vendor: p2pkhAddress(stranger.publicKey, 'chipnet'), amount: { sats: 2000 }, purpose: 'p', expiry: 2e9 },
      stranger.privateKey,
    );
    const bad = await handleVendorBuy(post({ txid: TXID, signed: foreign }), { env: env2, connectChain: async () => chain });
    expect(bad.status).toBe(400);
  });
});

describe('node adapter', () => {
  it('passes method, host and body through and writes the response', async () => {
    const seen: { url?: string; method?: string; body?: string } = {};
    const handler = toNodeHandler(async (request) => {
      seen.url = request.url;
      seen.method = request.method;
      seen.body = await request.text();
      return new Response('{"x":1}', { status: 201, headers: { 'content-type': 'application/json' } });
    });
    const req = Object.assign(Readable.from([Buffer.from('{"a":1}')]), {
      method: 'POST',
      url: '/api/vendor/buy',
      headers: { host: 'localhost:5173', 'content-type': 'application/json' },
    }) as unknown as IncomingMessage;
    const headers: Record<string, string> = {};
    let ended: Buffer | undefined;
    const res = {
      statusCode: 0,
      setHeader: (k: string, v: string) => (headers[k] = v),
      end: (b?: Buffer) => (ended = b),
    } as unknown as ServerResponse;
    await handler(req, res);
    expect(seen).toEqual({ url: 'http://localhost:5173/api/vendor/buy', method: 'POST', body: '{"a":1}' });
    expect(res.statusCode).toBe(201);
    expect(headers['content-type']).toBe('application/json');
    expect(ended?.toString()).toBe('{"x":1}');
  });
});
