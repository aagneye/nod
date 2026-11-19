/**
 * Receipt checks: does a transaction pay a Nod Request, and has a request been paid?
 */
import {
  binToHex,
  binsAreEqual,
  cashAddressToLockingBytecode,
  decodeTransaction,
  hexToBin,
  type TransactionCommon,
} from '@bitauth/libauth';
import { sortHistoryNewestFirst, type ChainReader } from './electrum.js';
import { decodeMemo, type Memo } from './memo.js';
import { hashBatch } from './request.js';
import type { NodRequest, ReceiptCheck, TokenAmount } from './types.js';

export interface ReceiptOptions {
  /**
   * All request hashes committed by a batch memo (any order is fine if hashBatch sorts).
   * Needed to accept a batch payment; without it, batch memos never match.
   */
  batchHashes?: Uint8Array[];
}

export interface FindPaymentOptions extends ReceiptOptions {
  /** Stop after looking at this many history entries (default 200). */
  maxTxs?: number;
}

const isTokenAmount = (a: NodRequest['amount']): a is TokenAmount => typeof (a as TokenAmount).token === 'string';

const vendorBytecode = (vendor: string): Uint8Array => {
  const decoded = cashAddressToLockingBytecode(vendor);
  if (typeof decoded === 'string') throw new Error(`Invalid vendor address ${vendor}: ${decoded}`);
  return decoded.bytecode;
};

/** Check a decoded transaction against a request. Pure, no network. */
export function checkTransaction(
  tx: TransactionCommon,
  req: NodRequest,
  requestHash: Uint8Array,
  opts: ReceiptOptions = {},
): ReceiptCheck {
  const reasons: string[] = [];
  const vendorLocking = vendorBytecode(req.vendor);

  // Vendor output + amount.
  const vendorOutputs = tx.outputs.filter((o) => binsAreEqual(o.lockingBytecode, vendorLocking));
  if (vendorOutputs.length === 0) {
    reasons.push('vendor output missing');
  } else {
    const amount = req.amount;
    const paid = vendorOutputs.some((o) => {
      if (isTokenAmount(amount)) {
        return (
          o.token !== undefined &&
          o.token.nft === undefined &&
          binToHex(o.token.category) === amount.token.toLowerCase() &&
          o.token.amount === BigInt(amount.units)
        );
      }
      return o.token === undefined && o.valueSatoshis === BigInt(amount.sats);
    });
    if (!paid) reasons.push('amount mismatch');
  }

  // Memo.
  const memos = tx.outputs.map((o) => decodeMemo(o.lockingBytecode)).filter((m): m is Memo => m !== null);
  if (memos.length === 0) {
    reasons.push('memo missing');
  } else if (!memos.some((m) => memoCommits(m, requestHash, opts))) {
    const hasBatch = memos.some((m) => m.kind === 'batch');
    reasons.push(hasBatch && !opts.batchHashes ? 'memo hash mismatch (batch memo; batch hashes not provided)' : 'memo hash mismatch');
  }

  return { ok: reasons.length === 0, reasons };
}

function memoCommits(memo: Memo, requestHash: Uint8Array, opts: ReceiptOptions): boolean {
  if (memo.kind === 'single') return binsAreEqual(memo.hash, requestHash);
  const batch = opts.batchHashes;
  if (!batch || batch.length === 0) return false;
  if (!batch.some((h) => binsAreEqual(h, requestHash))) return false;
  return binsAreEqual(memo.hash, hashBatch(batch));
}

const decodeHex = (hex: string): TransactionCommon | string => {
  try {
    return decodeTransaction(hexToBin(hex));
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

/** Fetch a transaction and check that it pays `req` and commits `requestHash` in its memo. */
export async function verifyReceipt(
  chain: ChainReader,
  txid: string,
  req: NodRequest,
  requestHash: Uint8Array,
  opts: ReceiptOptions = {},
): Promise<ReceiptCheck> {
  let hex: string;
  try {
    hex = await chain.getTransactionHex(txid);
  } catch (e) {
    return { ok: false, reasons: [`transaction not found: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const tx = decodeHex(hex);
  if (typeof tx === 'string') return { ok: false, reasons: [`transaction could not be decoded: ${tx}`] };
  return checkTransaction(tx, req, requestHash, opts);
}

/**
 * Paid check: scan the vendor's history newest-first and return the first transaction that
 * pays `req` exactly and commits `requestHash` (single memo, or batch memo when batchHashes given).
 */
export async function findPayment(
  chain: ChainReader,
  req: NodRequest,
  requestHash: Uint8Array,
  opts: FindPaymentOptions = {},
): Promise<{ txid: string } | null> {
  const history = sortHistoryNewestFirst(await chain.getHistory(req.vendor));
  const max = opts.maxTxs ?? 200;
  for (const { txid } of history.slice(0, max)) {
    let hex: string;
    try {
      hex = await chain.getTransactionHex(txid);
    } catch {
      continue;
    }
    const tx = decodeHex(hex);
    if (typeof tx === 'string') continue;
    if (checkTransaction(tx, req, requestHash, opts).ok) return { txid };
  }
  return null;
}
