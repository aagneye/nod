import { binToHex, encodeCashAddress, encodeLockingBytecodeP2pkh, hash160, secp256k1, sha256, utf8ToBin } from '@bitauth/libauth';
import type { Network, SpendableUtxo } from '../src/types.js';

/** Deterministic test key + addresses from a seed string. */
export function testWallet(seed: string, network: Network = 'chipnet') {
  const privateKey = sha256.hash(utf8ToBin(`nod-test-${seed}`));
  const publicKey = secp256k1.derivePublicKeyCompressed(privateKey);
  if (typeof publicKey === 'string') throw new Error(publicKey);
  const pkh = hash160(publicKey);
  const prefix = network === 'mainnet' ? 'bitcoincash' : 'bchtest';
  return {
    privateKey,
    publicKey,
    pkh,
    lockingBytecode: encodeLockingBytecodeP2pkh(pkh),
    address: encodeCashAddress({ prefix, type: 'p2pkh', payload: pkh }).address,
    tokenAddress: encodeCashAddress({ prefix, type: 'p2pkhWithTokens', payload: pkh }).address,
  };
}

let counter = 0;
/** Fake txid that is unique per call. */
export const fakeTxid = (): string => binToHex(sha256.hash(utf8ToBin(`txid-${counter++}`)));

export function bchUtxo(lockingBytecode: Uint8Array, satoshis: bigint, index = 0): SpendableUtxo {
  return {
    txid: fakeTxid(),
    vout: 0,
    satoshis,
    lockingBytecode: binToHex(lockingBytecode),
    path: ['receive', index],
  };
}

export function tokenUtxo(lockingBytecode: Uint8Array, category: string, amount: bigint, index = 0): SpendableUtxo {
  return {
    ...bchUtxo(lockingBytecode, 1000n, index),
    token: { category, amount },
  };
}

/** A 32-byte hash derived from a label. */
export const h = (label: string): Uint8Array => sha256.hash(utf8ToBin(label));

/** Stand-in for request.ts hashBatch: sha256 of the sorted concatenated hashes. */
export function fakeHashBatch(hashes: Uint8Array[]): Uint8Array {
  const sorted = hashes.map((x) => binToHex(x)).sort();
  return sha256.hash(utf8ToBin(sorted.join('')));
}
