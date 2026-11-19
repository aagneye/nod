import { describe, expect, it, vi } from 'vitest';
import { binToHex, decodeTransaction, encodeTransaction, hexToBin, type TransactionCommon } from '@bitauth/libauth';

vi.mock('../src/request.js', async () => {
  const { fakeHashBatch } = await import('./helpers.js');
  return { hashBatch: fakeHashBatch };
});

import { buildPayment } from '../src/tx.js';
import { decodeMemo } from '../src/memo.js';
import { DUST_SATS, MAX_BATCH, TOKEN_OUTPUT_SATS } from '../src/constants.js';
import { bchUtxo, fakeHashBatch, h, testWallet, tokenUtxo } from './helpers.js';

const buyer = testWallet('buyer');
const vendor = testWallet('vendor');
const vendor2 = testWallet('vendor2');
const CATEGORY = 'aa'.repeat(32);

const decode = (hex: string): TransactionCommon => {
  const tx = decodeTransaction(hexToBin(hex));
  if (typeof tx === 'string') throw new Error(tx);
  return tx;
};
const sumOut = (tx: TransactionCommon) => tx.outputs.reduce((s, o) => s + o.valueSatoshis, 0n);

describe('buildPayment (BCH)', () => {
  it('builds a single payment with memo and change', () => {
    const utxo = bchUtxo(buyer.lockingBytecode, 100_000n, 3);
    const r = buildPayment({
      network: 'chipnet',
      payments: [{ vendor: vendor.address, amount: { sats: 2500 }, requestHash: h('req1') }],
      utxos: [utxo],
      changeAddress: buyer.address,
    });
    const tx = decode(r.txHex);
    expect(tx.inputs).toHaveLength(1);
    expect(tx.inputs[0]!.unlockingBytecode.length).toBe(0);
    expect(binToHex(tx.inputs[0]!.outpointTransactionHash)).toBe(utxo.txid);
    expect(tx.outputs).toHaveLength(3);
    expect(binToHex(tx.outputs[0]!.lockingBytecode)).toBe(binToHex(vendor.lockingBytecode));
    expect(tx.outputs[0]!.valueSatoshis).toBe(2500n);
    const memo = decodeMemo(tx.outputs[1]!.lockingBytecode);
    expect(memo?.kind).toBe('single');
    expect(binToHex(memo!.hash)).toBe(binToHex(h('req1')));
    expect(tx.outputs[1]!.valueSatoshis).toBe(0n);
    expect(binToHex(tx.outputs[2]!.lockingBytecode)).toBe(binToHex(buyer.lockingBytecode));
    // Fee accounting.
    expect(100_000n - sumOut(tx)).toBe(r.fee);
    const estimated = BigInt(encodeTransaction(tx).length + 108);
    expect(r.fee).toBe(estimated);
    expect(r.fee).toBeLessThan(400n);
    expect(r.memo.kind).toBe('single');
    expect(r.inputPaths).toEqual([[0, 'receive', 3]]);
    expect(binToHex(r.transaction.outputs[0]!.lockingBytecode)).toBe(binToHex(vendor.lockingBytecode));
  });

  it('returns sourceOutputs matching the inputs', () => {
    const utxo = bchUtxo(buyer.lockingBytecode, 50_000n, 1);
    const r = buildPayment({
      network: 'chipnet',
      payments: [{ vendor: vendor.address, amount: { sats: 1000 }, requestHash: h('x') }],
      utxos: [utxo],
      changeAddress: buyer.address,
    });
    expect(r.sourceOutputs).toHaveLength(1);
    const so = r.sourceOutputs[0]!;
    expect(so.outpointIndex).toBe(0);
    expect(binToHex(so.outpointTransactionHash)).toBe(utxo.txid);
    expect(so.sequenceNumber).toBe(0xffffffff);
    expect(so.unlockingBytecode.length).toBe(0);
    expect(binToHex(so.lockingBytecode)).toBe(utxo.lockingBytecode);
    expect(so.valueSatoshis).toBe(50_000n);
    expect(so.token).toBeUndefined();
  });

  it('builds a batch with a batch memo, one output per payment', () => {
    const payments = [
      { vendor: vendor.address, amount: { sats: 1000 }, requestHash: h('a') },
      { vendor: vendor2.address, amount: { sats: 2000 }, requestHash: h('b') },
      { vendor: vendor.address, amount: { sats: 3000 }, requestHash: h('c') },
    ];
    const r = buildPayment({
      network: 'chipnet',
      payments,
      utxos: [bchUtxo(buyer.lockingBytecode, 5_000n), bchUtxo(buyer.lockingBytecode, 4_000n, 1)],
      changeAddress: buyer.address,
    });
    const tx = decode(r.txHex);
    expect(tx.inputs).toHaveLength(2);
    expect(tx.outputs.slice(0, 3).map((o) => o.valueSatoshis)).toEqual([1000n, 2000n, 3000n]);
    expect(binToHex(tx.outputs[1]!.lockingBytecode)).toBe(binToHex(vendor2.lockingBytecode));
    const memo = decodeMemo(tx.outputs[3]!.lockingBytecode)!;
    expect(memo.kind).toBe('batch');
    expect(binToHex(memo.hash)).toBe(binToHex(fakeHashBatch(payments.map((p) => p.requestHash))));
    expect(r.inputPaths.map((p) => p[0])).toEqual([0, 1]);
  });

  it('uses memoHash override', () => {
    const r = buildPayment({
      network: 'chipnet',
      payments: [{ vendor: vendor.address, amount: { sats: 1000 }, requestHash: h('a') }],
      utxos: [bchUtxo(buyer.lockingBytecode, 5_000n)],
      changeAddress: buyer.address,
      memoHash: h('override'),
    });
    expect(binToHex(r.memo.hash)).toBe(binToHex(h('override')));
  });

  it('selects only the coins it needs, largest first', () => {
    const big = bchUtxo(buyer.lockingBytecode, 90_000n);
    const small = bchUtxo(buyer.lockingBytecode, 1_000n);
    const r = buildPayment({
      network: 'chipnet',
      payments: [{ vendor: vendor.address, amount: { sats: 5000 }, requestHash: h('a') }],
      utxos: [small, big],
      changeAddress: buyer.address,
    });
    const tx = decode(r.txHex);
    expect(tx.inputs).toHaveLength(1);
    expect(binToHex(tx.inputs[0]!.outpointTransactionHash)).toBe(big.txid);
  });

  it('drops change below dust into the fee', () => {
    // 1000 out + ~250 fee; 1500 in leaves < 546 change.
    const r = buildPayment({
      network: 'chipnet',
      payments: [{ vendor: vendor.address, amount: { sats: 1000 }, requestHash: h('a') }],
      utxos: [bchUtxo(buyer.lockingBytecode, 1_500n)],
      changeAddress: buyer.address,
    });
    const tx = decode(r.txHex);
    expect(tx.outputs).toHaveLength(2);
    expect(r.fee).toBe(500n);
  });

  it('does not spend token or NFT coins for BCH payments', () => {
    const tok = tokenUtxo(buyer.lockingBytecode, CATEGORY, 10n);
    tok.satoshis = 1_000_000n;
    expect(() =>
      buildPayment({
        network: 'chipnet',
        payments: [{ vendor: vendor.address, amount: { sats: 1000 }, requestHash: h('a') }],
        utxos: [tok],
        changeAddress: buyer.address,
      }),
    ).toThrow(/Insufficient funds/);
  });
});

describe('buildPayment (tokens)', () => {
  it('pays tokens with a token output and returns token change', () => {
    const t1 = tokenUtxo(buyer.lockingBytecode, CATEGORY, 700n, 2);
    const t2 = tokenUtxo(buyer.lockingBytecode, CATEGORY, 500n, 4);
    const other = tokenUtxo(buyer.lockingBytecode, 'bb'.repeat(32), 999n);
    const fees = bchUtxo(buyer.lockingBytecode, 20_000n, 5);
    const r = buildPayment({
      network: 'chipnet',
      payments: [{ vendor: vendor.tokenAddress, amount: { token: CATEGORY, units: '1000' }, requestHash: h('t') }],
      utxos: [other, t2, t1, fees],
      changeAddress: buyer.address,
    });
    const tx = decode(r.txHex);
    expect(tx.inputs).toHaveLength(3);
    const pay = tx.outputs[0]!;
    expect(pay.valueSatoshis).toBe(TOKEN_OUTPUT_SATS);
    expect(binToHex(pay.token!.category)).toBe(CATEGORY);
    expect(pay.token!.amount).toBe(1000n);
    expect(decodeMemo(tx.outputs[1]!.lockingBytecode)?.kind).toBe('single');
    const tokenChange = tx.outputs[2]!;
    expect(tokenChange.token!.amount).toBe(200n);
    expect(binToHex(tokenChange.lockingBytecode)).toBe(binToHex(buyer.lockingBytecode));
    expect(tx.outputs[3]!.token).toBeUndefined();
    // Every source output with a token is described for the wallet.
    expect(r.sourceOutputs.filter((s) => s.token).length).toBe(2);
    expect(binToHex(r.sourceOutputs[0]!.token!.category)).toBe(CATEGORY);
    // No tokens burned: token in == token out.
    const tokIn = r.sourceOutputs.reduce((s, o) => s + (o.token?.amount ?? 0n), 0n);
    const tokOut = tx.outputs.reduce((s, o) => s + (o.token?.amount ?? 0n), 0n);
    expect(tokOut).toBe(tokIn);
    const satsIn = r.sourceOutputs.reduce((s, o) => s + o.valueSatoshis, 0n);
    expect(satsIn - sumOut(tx)).toBe(r.fee);
  });

  it('rejects token payments to non-token-aware addresses', () => {
    expect(() =>
      buildPayment({
        network: 'chipnet',
        payments: [{ vendor: vendor.address, amount: { token: CATEGORY, units: '1' }, requestHash: h('t') }],
        utxos: [tokenUtxo(buyer.lockingBytecode, CATEGORY, 5n), bchUtxo(buyer.lockingBytecode, 10_000n)],
        changeAddress: buyer.address,
      }),
    ).toThrow(/not token-aware/);
  });

  it('throws on insufficient tokens', () => {
    expect(() =>
      buildPayment({
        network: 'chipnet',
        payments: [{ vendor: vendor.tokenAddress, amount: { token: CATEGORY, units: '50' }, requestHash: h('t') }],
        utxos: [tokenUtxo(buyer.lockingBytecode, CATEGORY, 5n), bchUtxo(buyer.lockingBytecode, 10_000n)],
        changeAddress: buyer.address,
      }),
    ).toThrow(/Insufficient tokens/);
  });
});

describe('buildPayment errors', () => {
  const base = {
    network: 'chipnet' as const,
    utxos: [bchUtxo(buyer.lockingBytecode, 10_000n)],
    changeAddress: buyer.address,
  };

  it('requires 1..MAX_BATCH payments', () => {
    expect(() => buildPayment({ ...base, payments: [] })).toThrow(/At least one/);
    const many = Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({
      vendor: vendor.address,
      amount: { sats: 1000 },
      requestHash: h(`r${i}`),
    }));
    expect(() => buildPayment({ ...base, payments: many })).toThrow(/Too many payments/);
  });

  it('rejects dust amounts', () => {
    expect(() =>
      buildPayment({
        ...base,
        payments: [{ vendor: vendor.address, amount: { sats: Number(DUST_SATS) - 1 }, requestHash: h('a') }],
      }),
    ).toThrow(/dust/);
  });

  it('rejects addresses on the wrong network', () => {
    const mainVendor = testWallet('vendor', 'mainnet');
    expect(() =>
      buildPayment({ ...base, payments: [{ vendor: mainVendor.address, amount: { sats: 1000 }, requestHash: h('a') }] }),
    ).toThrow(/not a chipnet address/);
    expect(() =>
      buildPayment({
        ...base,
        changeAddress: mainVendor.address,
        payments: [{ vendor: vendor.address, amount: { sats: 1000 }, requestHash: h('a') }],
      }),
    ).toThrow(/Change address/);
  });

  it('throws on insufficient funds', () => {
    expect(() =>
      buildPayment({ ...base, payments: [{ vendor: vendor.address, amount: { sats: 10_000 }, requestHash: h('a') }] }),
    ).toThrow(/Insufficient funds/);
  });
});
