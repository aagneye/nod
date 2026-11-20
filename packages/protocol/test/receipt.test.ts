import { describe, expect, it, vi } from 'vitest';
import { binToHex, hashTransaction, hexToBin } from '@bitauth/libauth';

vi.mock('../src/request.js', async () => {
  const { fakeHashBatch } = await import('./helpers.js');
  return { hashBatch: fakeHashBatch };
});

import { buildPayment } from '../src/tx.js';
import { findPayment, verifyReceipt } from '../src/receipt.js';
import type { ChainReader } from '../src/electrum.js';
import type { NodRequest } from '../src/types.js';
import { bchUtxo, h, testWallet, tokenUtxo } from './helpers.js';

const buyer = testWallet('buyer');
const vendor = testWallet('vendor');
const other = testWallet('other');
const CATEGORY = 'cc'.repeat(32);

const makeReq = (amount: NodRequest['amount'], vendorAddr = vendor.address): NodRequest => ({
  v: 1,
  id: '00'.repeat(16),
  agent: '02' + '11'.repeat(32),
  agentName: 'test-bot',
  vendor: vendorAddr,
  amount,
  purpose: 'test',
  expiry: 2_000_000_000,
});

class FakeChain implements ChainReader {
  txs = new Map<string, string>();
  history: { txid: string; height: number }[] = [];
  add(txHex: string, height: number): string {
    const txid = hashTransaction(hexToBin(txHex));
    this.txs.set(txid, txHex);
    this.history.push({ txid, height });
    return txid;
  }
  async getHistory() {
    return this.history;
  }
  async getTransactionHex(txid: string) {
    const hex = this.txs.get(txid);
    if (!hex) throw new Error('not found');
    return hex;
  }
}

const pay = (payments: Parameters<typeof buildPayment>[0]['payments'], memoHash?: Uint8Array) =>
  buildPayment({
    network: 'chipnet',
    payments,
    utxos: [bchUtxo(buyer.lockingBytecode, 100_000n), tokenUtxo(buyer.lockingBytecode, CATEGORY, 1000n)],
    changeAddress: buyer.address,
    ...(memoHash ? { memoHash } : {}),
  }).txHex;

describe('verifyReceipt', () => {
  const req = makeReq({ sats: 2500 });
  const reqHash = h('req');

  it('accepts a matching single payment', async () => {
    const chain = new FakeChain();
    const txid = chain.add(pay([{ vendor: req.vendor, amount: req.amount, requestHash: reqHash }]), 100);
    expect(await verifyReceipt(chain, txid, req, reqHash)).toEqual({ ok: true, reasons: [] });
  });

  it('reports vendor output missing', async () => {
    const chain = new FakeChain();
    const txid = chain.add(pay([{ vendor: other.address, amount: req.amount, requestHash: reqHash }]), 100);
    const r = await verifyReceipt(chain, txid, req, reqHash);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain('vendor output missing');
  });

  it('reports amount mismatch', async () => {
    const chain = new FakeChain();
    const txid = chain.add(pay([{ vendor: req.vendor, amount: { sats: 2400 }, requestHash: reqHash }]), 100);
    expect((await verifyReceipt(chain, txid, req, reqHash)).reasons).toEqual(['amount mismatch']);
  });

  it('reports memo hash mismatch', async () => {
    const chain = new FakeChain();
    const txid = chain.add(pay([{ vendor: req.vendor, amount: req.amount, requestHash: h('other') }]), 100);
    expect((await verifyReceipt(chain, txid, req, reqHash)).reasons).toEqual(['memo hash mismatch']);
  });

  it('reports memo missing', async () => {
    const chain = new FakeChain();
    const built = buildPayment({
      network: 'chipnet',
      payments: [{ vendor: req.vendor, amount: req.amount, requestHash: reqHash }],
      utxos: [bchUtxo(buyer.lockingBytecode, 100_000n)],
      changeAddress: buyer.address,
    });
    // Strip the memo output.
    const tx = { ...built.transaction, outputs: built.transaction.outputs.filter((o) => o.lockingBytecode[0] !== 0x6a) };
    const { encodeTransaction } = await import('@bitauth/libauth');
    const txid = chain.add(binToHex(encodeTransaction(tx)), 100);
    expect((await verifyReceipt(chain, txid, req, reqHash)).reasons).toEqual(['memo missing']);
  });

  it('reports a missing transaction', async () => {
    const r = await verifyReceipt(new FakeChain(), 'ff'.repeat(32), req, reqHash);
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toMatch(/transaction not found/);
  });

  it('checks token payments', async () => {
    const tReq = makeReq({ token: CATEGORY, units: '300' }, vendor.tokenAddress);
    const chain = new FakeChain();
    const txid = chain.add(pay([{ vendor: tReq.vendor, amount: tReq.amount, requestHash: reqHash }]), 100);
    expect((await verifyReceipt(chain, txid, tReq, reqHash)).ok).toBe(true);
    const wrong = makeReq({ token: CATEGORY, units: '301' }, vendor.tokenAddress);
    expect((await verifyReceipt(chain, txid, wrong, reqHash)).reasons).toEqual(['amount mismatch']);
    // A BCH request for TOKEN_OUTPUT_SATS must not be satisfied by the token output.
    const bchReq = makeReq({ sats: 1000 }, vendor.tokenAddress);
    expect((await verifyReceipt(chain, txid, bchReq, reqHash)).reasons).toEqual(['amount mismatch']);
  });

  it('accepts batch payments only with the batch hashes', async () => {
    const reqB = makeReq({ sats: 1500 }, other.address);
    const hashes = [reqHash, h('reqB')];
    const chain = new FakeChain();
    const txid = chain.add(
      pay([
        { vendor: req.vendor, amount: req.amount, requestHash: hashes[0]! },
        { vendor: reqB.vendor, amount: reqB.amount, requestHash: hashes[1]! },
      ]),
      100,
    );
    expect((await verifyReceipt(chain, txid, req, reqHash)).ok).toBe(false);
    expect(await verifyReceipt(chain, txid, req, reqHash, { batchHashes: hashes })).toEqual({ ok: true, reasons: [] });
    expect(await verifyReceipt(chain, txid, reqB, hashes[1]!, { batchHashes: [...hashes].reverse() })).toEqual({
      ok: true,
      reasons: [],
    });
    // Request not in the batch list.
    expect((await verifyReceipt(chain, txid, req, h('nope'), { batchHashes: hashes })).ok).toBe(false);
    // Wrong batch list.
    expect((await verifyReceipt(chain, txid, req, reqHash, { batchHashes: [reqHash] })).ok).toBe(false);
  });

  it('needs one output per identical batch request when the batch requests are known', async () => {
    const reqA = { ...req, id: 'aa'.repeat(16) };
    const reqB = { ...req, id: 'bb'.repeat(16) };
    const hashes = [h('A'), h('B')];
    const chain = new FakeChain();
    // Batch memo commits both requests, but only one 2500-sat output pays the vendor.
    const { fakeHashBatch } = await import('./helpers.js');
    const underpaid = chain.add(
      pay(
        [
          { vendor: req.vendor, amount: req.amount, requestHash: hashes[0]! },
          { vendor: other.address, amount: { sats: 600 }, requestHash: h('filler') },
        ],
        fakeHashBatch(hashes),
      ),
      100,
    );
    const opts = { batchHashes: hashes, batchRequests: [reqA, reqB] };
    const r = await verifyReceipt(chain, underpaid, reqB, hashes[1]!, opts);
    expect(r.ok).toBe(false);
    expect(r.reasons).toEqual(['batch underpaid: 2 outputs needed, 1 found']);

    const paid = chain.add(
      pay([
        { vendor: req.vendor, amount: req.amount, requestHash: hashes[0]! },
        { vendor: req.vendor, amount: req.amount, requestHash: hashes[1]! },
      ]),
      101,
    );
    expect(await verifyReceipt(chain, paid, reqB, hashes[1]!, opts)).toEqual({ ok: true, reasons: [] });
  });
});

describe('findPayment', () => {
  const req = makeReq({ sats: 2500 });
  const reqHash = h('find');

  it('finds the paying tx among unrelated history, newest first', async () => {
    const chain = new FakeChain();
    chain.add(pay([{ vendor: req.vendor, amount: { sats: 9999 }, requestHash: h('x') }]), 10);
    const older = chain.add(pay([{ vendor: req.vendor, amount: req.amount, requestHash: reqHash }]), 50);
    chain.add(pay([{ vendor: req.vendor, amount: req.amount, requestHash: h('y') }]), 60);
    const mempool = chain.add(
      buildPayment({
        network: 'chipnet',
        payments: [{ vendor: req.vendor, amount: req.amount, requestHash: reqHash }],
        utxos: [bchUtxo(buyer.lockingBytecode, 77_000n)],
        changeAddress: buyer.address,
      }).txHex,
      0,
    );
    expect(await findPayment(chain, req, reqHash)).toEqual({ txid: mempool });
    chain.history = chain.history.filter((e) => e.txid !== mempool);
    expect(await findPayment(chain, req, reqHash)).toEqual({ txid: older });
  });

  it('returns null when unpaid', async () => {
    const chain = new FakeChain();
    chain.add(pay([{ vendor: req.vendor, amount: req.amount, requestHash: h('y') }]), 60);
    expect(await findPayment(chain, req, reqHash)).toBeNull();
  });

  it('finds batch payments when batch hashes are given', async () => {
    const hashes = [reqHash, h('sibling')];
    const chain = new FakeChain();
    const txid = chain.add(
      pay([
        { vendor: req.vendor, amount: req.amount, requestHash: hashes[0]! },
        { vendor: other.address, amount: { sats: 800 }, requestHash: hashes[1]! },
      ]),
      5,
    );
    expect(await findPayment(chain, req, reqHash)).toBeNull();
    expect(await findPayment(chain, req, reqHash, { batchHashes: hashes })).toEqual({ txid });
  });
});
