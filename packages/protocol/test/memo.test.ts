import { describe, expect, it } from 'vitest';
import { binToHex } from '@bitauth/libauth';
import { decodeMemo, encodeMemo } from '../src/memo.js';

const hash = Uint8Array.from({ length: 32 }, (_, i) => i);

describe('memo', () => {
  it('encodes OP_RETURN "NOD" <kind> <hash>', () => {
    const bytes = encodeMemo('single', hash);
    expect(binToHex(bytes)).toBe('6a' + '034e4f44' + '0101' + '20' + binToHex(hash));
    expect(bytes.length).toBe(40);
    expect(binToHex(encodeMemo('batch', hash)).slice(10, 14)).toBe('0102');
  });

  it('round-trips both kinds', () => {
    for (const kind of ['single', 'batch'] as const) {
      const decoded = decodeMemo(encodeMemo(kind, hash));
      expect(decoded?.kind).toBe(kind);
      expect(binToHex(decoded!.hash)).toBe(binToHex(hash));
    }
  });

  it('accepts OP_1/OP_2 minimal-push kind', () => {
    const bytes = Uint8Array.from([0x6a, 0x03, 0x4e, 0x4f, 0x44, 0x52, 0x20, ...hash]);
    expect(decodeMemo(bytes)?.kind).toBe('batch');
  });

  it('rejects non-memos', () => {
    const good = encodeMemo('single', hash);
    expect(decodeMemo(new Uint8Array())).toBeNull();
    expect(decodeMemo(good.slice(1))).toBeNull(); // no OP_RETURN
    const wrongPrefix = good.slice();
    wrongPrefix[2] = 0x41;
    expect(decodeMemo(wrongPrefix)).toBeNull();
    const badKind = good.slice();
    badKind[6] = 0x07;
    expect(decodeMemo(badKind)).toBeNull();
    expect(decodeMemo(Uint8Array.from([...good, 0x00]))).toBeNull(); // trailing data
    expect(decodeMemo(good.slice(0, 39))).toBeNull(); // short hash
  });

  it('rejects hashes that are not 32 bytes', () => {
    expect(() => encodeMemo('single', new Uint8Array(31))).toThrow(/32 bytes/);
  });
});
