import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { binToHex } from '@bitauth/libauth';
import { buildPayment, decodeLink, hashRequest, verifyRequest } from '@nod/protocol';
import { describe, expect, it } from 'vitest';
import { runCli, parseCliArgs } from '../src/cli.js';
import { checkStatus, createPaymentRequest, listRequests, parseDuration } from '../src/core.js';
import { agentAddress, loadAgentKey } from '../src/keys.js';
import { addRequest, findRequest, markPaid, readStore, storePath } from '../src/store.js';
import { FakeChain, VENDOR, fakeTxid, tempEnv, testWallet } from './helpers.js';

const payloadOf = (link: string) => link.slice(link.indexOf('#') + 1);

describe('keys', () => {
  it('creates a key in NOD_HOME on first use and reloads it after', () => {
    const env = tempEnv();
    const first = loadAgentKey(env);
    expect(first.source).toBe('created');
    expect(first.publicKey).toMatch(/^0[23][0-9a-f]{64}$/);
    expect(existsSync(join(env.NOD_HOME!, 'agent.key'))).toBe(true);
    const again = loadAgentKey(env);
    expect(again.source).toBe('file');
    expect(again.publicKey).toBe(first.publicKey);
  });

  it('prefers NOD_AGENT_KEY and rejects bad keys', () => {
    const env = tempEnv({ NOD_AGENT_KEY: '11'.repeat(32) });
    const k = loadAgentKey(env);
    expect(k.source).toBe('env');
    expect(existsSync(join(env.NOD_HOME!, 'agent.key'))).toBe(false);
    expect(agentAddress(k.publicKey, 'chipnet')).toMatch(/^bchtest:q/);
    expect(() => loadAgentKey(tempEnv({ NOD_AGENT_KEY: 'zz' }))).toThrow(/64 hex/);
  });
});

describe('store', () => {
  it('is empty without a file, adds, finds by prefix and marks paid', () => {
    const env = tempEnv();
    expect(readStore(env)).toEqual([]);
    const rec = createPaymentRequest({ vendor: VENDOR, sats: 1000, purpose: 'store test', env });
    expect(existsSync(storePath(env))).toBe(true);
    expect(readStore(env)).toHaveLength(1);
    expect(findRequest(rec.id, env)?.hash).toBe(rec.hash);
    expect(findRequest(rec.hash.slice(0, 10), env)?.id).toBe(rec.id);
    expect(findRequest('abc', env)).toBeUndefined();
    markPaid(rec.id, 'ff'.repeat(32), env);
    expect(findRequest(rec.id, env)?.paidTxid).toBe('ff'.repeat(32));
    // Re-adding the same id replaces rather than duplicates.
    addRequest({ ...rec, link: 'x' }, env);
    expect(readStore(env)).toHaveLength(1);
    expect(JSON.parse(readFileSync(storePath(env), 'utf8'))[0].link).toBe('x');
  });
});

describe('createPaymentRequest', () => {
  it('signs a request whose link decodes and verifies', () => {
    const env = tempEnv();
    const now = Math.floor(Date.now() / 1000);
    const rec = createPaymentRequest({ vendor: VENDOR, sats: 2000, purpose: '1 weather report', expiresIn: 1800, env, now });
    expect(rec.link.startsWith('https://nod.example/r#')).toBe(true);
    const d = decodeLink(payloadOf(rec.link));
    expect(d.valid).toBe(true);
    expect(d.expired).toBe(false);
    expect(verifyRequest(d.signed)).toBe(true);
    expect(d.signed.req).toMatchObject({ vendor: VENDOR, amount: { sats: 2000 }, purpose: '1 weather report', expiry: now + 1800 });
    expect(d.signed.req.agent).toBe(loadAgentKey(env).publicKey);
    expect(rec.hash).toBe(binToHex(hashRequest(d.signed.req)));
  });

  it('rejects wrong-network vendors, dust and long purposes', () => {
    const env = tempEnv();
    expect(() => createPaymentRequest({ vendor: VENDOR, sats: 1000, purpose: 'x', env: { ...env, NOD_NETWORK: 'mainnet' } })).toThrow(/mainnet address/);
    expect(() => createPaymentRequest({ vendor: VENDOR, sats: 100, purpose: 'x', env })).toThrow(/dust/);
    expect(() => createPaymentRequest({ vendor: VENDOR, sats: 1000, purpose: 'x'.repeat(141), env })).toThrow(/purpose/);
  });

  it('parses durations', () => {
    expect(parseDuration('30m')).toBe(1800);
    expect(parseDuration('1h')).toBe(3600);
    expect(parseDuration('2d')).toBe(172800);
    expect(parseDuration('600')).toBe(600);
    expect(() => parseDuration('soon')).toThrow();
    expect(() => parseDuration('10s')).toThrow(/at least/);
  });
});

describe('checkStatus', () => {
  it('reports unpaid, then paid with txid once a matching NOD payment is on chain', async () => {
    const env = tempEnv();
    const vendor = testWallet('vendor');
    const buyer = testWallet('buyer');
    const rec = createPaymentRequest({ vendor: vendor.address, sats: 1500, purpose: 'status test', env });
    const chain = new FakeChain();
    expect((await checkStatus(rec.id, { env, chain })).status).toBe('unpaid');

    const req = rec.signed.req;
    const { txHex } = buildPayment({
      network: 'chipnet',
      payments: [{ vendor: req.vendor, amount: req.amount, requestHash: hashRequest(req) }],
      utxos: [
        { txid: fakeTxid('u1'), vout: 0, satoshis: 100_000n, lockingBytecode: binToHex(buyer.lockingBytecode), path: ['receive', 0] },
      ],
      changeAddress: buyer.address,
    });
    const txid = chain.add(txHex);
    const s = await checkStatus(rec.id.slice(0, 8), { env, chain });
    expect(s).toMatchObject({ status: 'paid', txid });
    expect(s.explorerUrl).toContain(txid);
    expect(listRequests(env)[0]?.paidTxid).toBe(txid);
  });
});

describe('cli', () => {
  const capture = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) }, out, err };
  };

  it('parses arguments', () => {
    const p = parseCliArgs(['request', '--vendor', VENDOR, '--sats', '1000', '--purpose', 'a b', '--expiry', '1h']);
    expect(p.command).toBe('request');
    expect(p.values).toMatchObject({ vendor: VENDOR, sats: '1000', purpose: 'a b', expiry: '1h' });
    expect(() => parseCliArgs(['request', '--nope'])).toThrow();
  });

  it('request prints a link that decodeLink and verifyRequest accept; list shows it', async () => {
    const env = tempEnv();
    const c = capture();
    const code = await runCli(
      ['request', '--vendor', VENDOR, '--sats', '1000', '--purpose', 'test', '--app-url', 'http://localhost:5173/'],
      c.io,
      env,
    );
    expect(code).toBe(0);
    const link = c.out.find((l) => l.startsWith('http://localhost:5173/r#'));
    expect(link).toBeDefined();
    const d = decodeLink(payloadOf(link!));
    expect(d.valid && !d.expired && verifyRequest(d.signed)).toBe(true);

    const l = capture();
    expect(await runCli(['list'], l.io, env)).toBe(0);
    expect(l.out.join('\n')).toContain(d.signed.req.id.slice(0, 8));
  });

  it('key prints the public key; bad input exits 2', async () => {
    const env = tempEnv();
    const c = capture();
    expect(await runCli(['key', '--json'], c.io, env)).toBe(0);
    expect(JSON.parse(c.out.join('\n')).publicKey).toBe(loadAgentKey(env).publicKey);
    const bad = capture();
    expect(await runCli(['request', '--vendor', VENDOR], bad.io, env)).toBe(2);
    expect(bad.err.join('\n')).toMatch(/--sats/);
  });
});
