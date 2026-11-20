import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  binToHex,
  encodeCashAddress,
  encodeLockingBytecodeP2pkh,
  hash160,
  hashTransaction,
  hexToBin,
  secp256k1,
  sha256,
  utf8ToBin,
} from '@bitauth/libauth';
import type { ChainReader } from '@nod/protocol';

export const VENDOR = 'bchtest:qr4upmst92u7sfm6vqxz29r4ug4rysdpcytc853pps';

/** Fresh environment with an empty NOD_HOME in the OS temp dir. */
export const tempEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  NOD_HOME: mkdtempSync(join(tmpdir(), 'nod-agent-test-')),
  NOD_NETWORK: 'chipnet',
  NOD_BASE_URL: 'https://nod.example',
  ...extra,
});

/** Deterministic chipnet wallet for building fake payments. */
export const testWallet = (seed: string) => {
  const privateKey = sha256.hash(utf8ToBin(`nod-agent-test-${seed}`));
  const publicKey = secp256k1.derivePublicKeyCompressed(privateKey);
  if (typeof publicKey === 'string') throw new Error(publicKey);
  const pkh = hash160(publicKey);
  return {
    lockingBytecode: encodeLockingBytecodeP2pkh(pkh),
    address: encodeCashAddress({ prefix: 'bchtest', type: 'p2pkh', payload: pkh }).address,
  };
};

export const fakeTxid = (label: string): string => binToHex(sha256.hash(utf8ToBin(label)));

export class FakeChain implements ChainReader {
  txs = new Map<string, string>();
  history: { txid: string; height: number }[] = [];
  add(txHex: string, height = 0): string {
    const txid = hashTransaction(hexToBin(txHex));
    this.txs.set(txid, txHex);
    this.history.unshift({ txid, height });
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
