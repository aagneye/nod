/**
 * On-chain memo: `OP_RETURN <"NOD"> <kind> <32-byte hash>`.
 * kind 0x01 = one request hash, 0x02 = hash of a batch of request hashes.
 */
import { hexToBin } from '@bitauth/libauth';
import { MEMO_KIND_BATCH, MEMO_KIND_SINGLE, MEMO_PREFIX_HEX } from './constants.js';

export type MemoKind = 'single' | 'batch';

export interface Memo {
  kind: MemoKind;
  hash: Uint8Array;
}

const OP_RETURN = 0x6a;
const OP_1 = 0x51;
/** "NOD" (3 bytes). */
const PREFIX = hexToBin(MEMO_PREFIX_HEX);

const kindToByte = (kind: MemoKind): number => {
  if (kind === 'single') return MEMO_KIND_SINGLE;
  if (kind === 'batch') return MEMO_KIND_BATCH;
  throw new Error(`Unknown memo kind: ${String(kind)}`);
};

const byteToKind = (byte: number): MemoKind | null =>
  byte === MEMO_KIND_SINGLE ? 'single' : byte === MEMO_KIND_BATCH ? 'batch' : null;

/** Build the OP_RETURN locking bytecode (40 bytes). */
export function encodeMemo(kind: MemoKind, hash: Uint8Array): Uint8Array {
  if (!(hash instanceof Uint8Array) || hash.length !== 32) {
    throw new Error('Memo hash must be 32 bytes');
  }
  const out = new Uint8Array(1 + 1 + 3 + 1 + 1 + 1 + 32);
  let i = 0;
  out[i++] = OP_RETURN;
  out[i++] = 3;
  out.set(PREFIX, i);
  i += 3;
  out[i++] = 1;
  out[i++] = kindToByte(kind);
  out[i++] = 32;
  out.set(hash, i);
  return out;
}

/**
 * Parse a locking bytecode as a Nod memo. Returns null for anything that is not one.
 * Also accepts the kind pushed as OP_1 / OP_2 (minimal-push form) for robustness.
 */
export function decodeMemo(lockingBytecode: Uint8Array): Memo | null {
  const b = lockingBytecode;
  if (!b || b.length < 1 + 4 + 1 + 33 || b[0] !== OP_RETURN) return null;
  let i = 1;
  if (b[i++] !== 3) return null;
  for (let k = 0; k < 3; k++) if (b[i++] !== PREFIX[k]) return null;
  let kindByte: number;
  if (b[i] === 1) {
    kindByte = b[i + 1]!;
    i += 2;
  } else if (b[i] === OP_1 || b[i] === OP_1 + 1) {
    kindByte = b[i]! - OP_1 + 1;
    i += 1;
  } else {
    return null;
  }
  const kind = byteToKind(kindByte);
  if (kind === null) return null;
  if (b[i++] !== 32) return null;
  if (b.length !== i + 32) return null;
  return { kind, hash: b.slice(i, i + 32) };
}
