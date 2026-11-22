import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeLink, hashTerms, verifyTerms } from '@nod/protocol';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { parseCliArgs, runCli } from '../src/cli.js';
import { checkStatus, createPaymentRequest, listRequests, normalizeUsd, parseDuration } from '../src/core.js';
import { keyPath, loadAgentKey } from '../src/keys.js';
import { addRequest, findRequest, readStore, storePath } from '../src/store.js';
import { PAY_TO, SETTLEMENT_TX, fakeReceiptServer, tempEnv } from './helpers.js';

const KEY = `0x${'11'.repeat(32)}`;

describe('keys', () => {
  it('creates a key in NOD_HOME on first use and reloads it after', () => {
    const env = tempEnv();
    const first = loadAgentKey(env);
    expect(first.source).toBe('created');
    expect(first.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(existsSync(keyPath(env))).toBe(true);
    const again = loadAgentKey(env);
    expect(again.source).toBe('file');
    expect(again.address).toBe(first.address);
  });

  it('prefers NOD_AGENT_KEY (with or without 0x) and rejects bad keys', () => {
    const env = tempEnv({ NOD_AGENT_KEY: KEY });
    const k = loadAgentKey(env);
    expect(k.source).toBe('env');
    expect(k.address).toBe(privateKeyToAccount(KEY as `0x${string}`).address);
    expect(existsSync(join(env.NOD_HOME!, 'agent.key'))).toBe(false);
    expect(loadAgentKey(tempEnv({ NOD_AGENT_KEY: KEY.slice(2) })).address).toBe(k.address);
    expect(() => loadAgentKey(tempEnv({ NOD_AGENT_KEY: 'zz' }))).toThrow(/64 hex/);
    expect(() => loadAgentKey(tempEnv({ NOD_AGENT_KEY: `0x${'00'.repeat(32)}` }))).toThrow(/not a valid/);
  });
});

describe('createPaymentRequest', () => {
  it('signs terms whose link decodes and verifies', async () => {
    const env = tempEnv({ NOD_AGENT_KEY: KEY });
    const rec = await createPaymentRequest({ payTo: PAY_TO.toLowerCase(), amountUsd: '0.10', purpose: '1 weather report', expiresIn: 1800, env });
    expect(rec.link.startsWith('https://nod.example/r#')).toBe(true);
    const signed = decodeLink(rec.link);
    expect(await verifyTerms(signed)).toMatchObject({ valid: true, expired: false });
    expect(signed.terms).toMatchObject({ v: 2, merchant: 'Nod agent', payTo: PAY_TO, amountUsd: '0.10', purpose: '1 weather report' });
    expect(signed.terms.agent).toBe(loadAgentKey(env).address);
    expect(signed.terms.expiry - Math.floor(Date.now() / 1000)).toBeGreaterThan(1790);
    expect(rec.termsHash).toBe(hashTerms(signed.terms));
    expect(rec.id).toBe(signed.terms.id);
  });

  it('uses --merchant / NOD_AGENT_NAME and normalizes amounts', async () => {
    const env = tempEnv({ NOD_AGENT_NAME: 'Research bot' });
    expect(decodeLink((await createPaymentRequest({ payTo: PAY_TO, amountUsd: '$.5', purpose: 'x', env })).link).terms).toMatchObject({
      merchant: 'Research bot',
      amountUsd: '0.5',
    });
    const named = await createPaymentRequest({ payTo: PAY_TO, amountUsd: 2, purpose: 'x', merchant: 'Acme', env });
    expect(decodeLink(named.link).terms).toMatchObject({ merchant: 'Acme', amountUsd: '2' });
    expect(normalizeUsd(' 0.10 USD')).toBe('0.10');
  });

  it('rejects bad recipients, amounts and purposes', async () => {
    const env = tempEnv();
    const badChecksum = PAY_TO.slice(0, 2) + PAY_TO.slice(2).replace(/[a-f]/, (c) => c.toUpperCase());
    await expect(createPaymentRequest({ payTo: badChecksum, amountUsd: '1', purpose: 'x', env })).rejects.toThrow(/checksum/);
    await expect(createPaymentRequest({ payTo: 'not-an-address', amountUsd: '1', purpose: 'x', env })).rejects.toThrow(/payTo/);
    await expect(createPaymentRequest({ payTo: PAY_TO, amountUsd: '0.001', purpose: 'x', env })).rejects.toThrow(/amountUsd/);
    await expect(createPaymentRequest({ payTo: PAY_TO, amountUsd: '20000', purpose: 'x', env })).rejects.toThrow(/amountUsd/);
    await expect(createPaymentRequest({ payTo: PAY_TO, amountUsd: '1', purpose: 'x'.repeat(141), env })).rejects.toThrow(/purpose/);
  });

  it('parses durations', () => {
    expect(parseDuration('30m')).toBe(1800);
    expect(parseDuration('1h')).toBe(3600);
    expect(parseDuration('2d')).toBe(172800);
    expect(parseDuration('600')).toBe(600);
    expect(() => parseDuration('soon')).toThrow();
    expect(() => parseDuration('10s')).toThrow(/at least/);
    expect(() => parseDuration('31d')).toThrow(/at most/);
  });
});

describe('store', () => {
  it('is empty without a file, finds by id, termsHash or prefix, and ignores foreign records', async () => {
    const env = tempEnv();
    expect(readStore(env)).toEqual([]);
    const rec = await createPaymentRequest({ payTo: PAY_TO, amountUsd: '1', purpose: 'store test', env });
    expect(existsSync(storePath(env))).toBe(true);
    expect(findRequest(rec.id, env)?.termsHash).toBe(rec.termsHash);
    expect(findRequest(rec.termsHash, env)?.id).toBe(rec.id);
    expect(findRequest(rec.termsHash.slice(0, 12), env)?.id).toBe(rec.id);
    expect(findRequest(rec.termsHash.slice(2, 12), env)?.id).toBe(rec.id);
    expect(findRequest('abc', env)).toBeUndefined();

    addRequest({ ...rec, link: 'x' }, env); // same id replaces
    expect(readStore(env)).toHaveLength(1);
    expect(JSON.parse(readFileSync(storePath(env), 'utf8'))[0].link).toBe('x');

    writeFileSync(storePath(env), JSON.stringify([{ id: 'old', hash: 'ff' }, ...JSON.parse(readFileSync(storePath(env), 'utf8'))]));
    expect(readStore(env)).toHaveLength(1);
  });
});

describe('checkStatus', () => {
  it('asks the Nod server for the receipt: unpaid, then paid', async () => {
    const env = tempEnv();
    const rec = await createPaymentRequest({ payTo: PAY_TO, amountUsd: '0.10', purpose: 'status test', env });
    const unpaid = fakeReceiptServer();
    const before = await checkStatus(rec.termsHash.slice(0, 10), { env, fetch: unpaid.fetch });
    expect(before).toMatchObject({ status: 'unpaid', termsHash: rec.termsHash, id: rec.id, link: rec.link });
    expect(unpaid.urls).toEqual([`https://nod.example/api/receipt?termsHash=${rec.termsHash}`]);

    const paid = fakeReceiptServer({ paid: [rec.termsHash] });
    const after = await checkStatus(rec.id, { env, fetch: paid.fetch });
    expect(after.status).toBe('paid');
    expect(after.receipt).toMatchObject({ settlementTx: SETTLEMENT_TX, chainId: 11155111, amount: '100000' });
    expect(after.settlementUrl).toBe(`https://sepolia.etherscan.io/tx/${SETTLEMENT_TX}`);
    expect(listRequests(env)[0]?.paid).toBe(SETTLEMENT_TX);
  });

  it('looks up any full termsHash, reports unconfigured servers, and explains failures', async () => {
    const env = tempEnv();
    const hash = `0x${'77'.repeat(32)}`;
    expect((await checkStatus(hash, { env, fetch: fakeReceiptServer({ paid: [hash] }).fetch })).status).toBe('paid');
    const unknown = await checkStatus(hash, { env, fetch: fakeReceiptServer({ contract: null }).fetch });
    expect(unknown).toMatchObject({ status: 'unknown', note: 'NOD_RECEIPTS_ADDRESS is not set' });
    await expect(checkStatus('nope', { env })).rejects.toThrow(/No terms "nope"/);
    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(checkStatus(hash, { env, fetch: down })).rejects.toThrow(/Could not reach the Nod server at https:\/\/nod\.example/);
    const html = (async () => new Response('<html></html>', { status: 200 })) as unknown as typeof fetch;
    await expect(checkStatus(hash, { env, fetch: html })).rejects.toThrow(/did not answer with JSON/);
  });
});

describe('cli', () => {
  const capture = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) }, out, err };
  };

  it('parses arguments', () => {
    const p = parseCliArgs(['request', '--pay-to', PAY_TO, '--usd', '0.10', '--purpose', 'a b', '--expires', '1h']);
    expect(p.command).toBe('request');
    expect(p.values).toMatchObject({ 'pay-to': PAY_TO, usd: '0.10', purpose: 'a b', expires: '1h' });
    expect(() => parseCliArgs(['request', '--vendor', 'x'])).toThrow();
  });

  it('request prints a link and termsHash that decodeLink and verifyTerms accept; list shows it', async () => {
    const env = tempEnv();
    const c = capture();
    const code = await runCli(
      ['request', '--pay-to', PAY_TO, '--usd', '0.10', '--purpose', 'test', '--merchant', 'Test agent', '--app-url', 'http://localhost:5173/'],
      c.io,
      env,
    );
    expect(code).toBe(0);
    const link = c.out.find((l) => l.startsWith('http://localhost:5173/r#'));
    expect(link).toBeDefined();
    const signed = decodeLink(link!);
    expect((await verifyTerms(signed)).valid).toBe(true);
    expect(signed.terms.merchant).toBe('Test agent');
    expect(c.out.join('\n')).toContain(`termsHash: ${hashTerms(signed.terms)}`);

    const l = capture();
    expect(await runCli(['list'], l.io, env)).toBe(0);
    expect(l.out.join('\n')).toContain(hashTerms(signed.terms).slice(0, 10));

    const s = capture();
    expect(await runCli(['status', hashTerms(signed.terms)], s.io, env, fakeReceiptServer({ paid: [hashTerms(signed.terms)] }).fetch)).toBe(0);
    expect(s.out[0]).toMatch(/: PAID$/);
  });

  it('key prints the address; bad input exits 2', async () => {
    const env = tempEnv();
    const c = capture();
    expect(await runCli(['key', '--json'], c.io, env)).toBe(0);
    expect(JSON.parse(c.out.join('\n')).address).toBe(loadAgentKey(env).address);
    const bad = capture();
    expect(await runCli(['request', '--pay-to', PAY_TO], bad.io, env)).toBe(2);
    expect(bad.err.join('\n')).toMatch(/--usd/);
    const help = capture();
    expect(await runCli(['--help'], help.io, env)).toBe(0);
    expect(help.out.join('\n')).toMatch(/--pay-to <0x address> --usd <amount>/);
    expect(help.out.join('\n')).toMatch(/HSK Chain/);
  });
});
