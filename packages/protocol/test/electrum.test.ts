import { describe, expect, it } from 'vitest';
import { NodElectrum, sortHistoryNewestFirst } from '../src/electrum.js';
import { testWallet } from './helpers.js';

describe('electrum helpers', () => {
  it('sorts history newest first with mempool entries on top', () => {
    const sorted = sortHistoryNewestFirst([
      { txid: 'a', height: 100 },
      { txid: 'b', height: 0 },
      { txid: 'c', height: 300 },
      { txid: 'd', height: -1 },
    ]);
    expect(sorted.map((x) => x.txid)).toEqual(['b', 'd', 'c', 'a']);
  });

  it('rejects addresses from the wrong network before touching the network', async () => {
    const e = new NodElectrum('mainnet', ['127.0.0.1:1']);
    await expect(e.getHistory(testWallet('x', 'chipnet').address)).rejects.toThrow(/not a mainnet address/);
  });
});

// Live smoke test; run manually with `it` instead of `it.skip`.
describe('NodElectrum (live chipnet)', () => {
  it.skip('reads block height and history', async () => {
    const e = new NodElectrum('chipnet');
    await e.connect();
    try {
      expect(await e.getBlockHeight()).toBeGreaterThan(100_000);
    } finally {
      await e.disconnect();
    }
  }, 30_000);
});
