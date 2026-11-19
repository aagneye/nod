/**
 * Unsigned payment transaction builder.
 *
 * Output order: [payment 0 .. payment n-1] [OP_RETURN memo] [token change...] [BCH change?]
 * Inputs carry empty unlocking bytecode; the wallet (WizardConnect) signs them.
 */
import {
  binToHex,
  cashAddressToLockingBytecode,
  encodeTransaction,
  hexToBin,
  type Input,
  type Output,
  type TransactionCommon,
} from '@bitauth/libauth';
import {
  CASHADDR_PREFIX,
  DUST_SATS,
  FEE_SATS_PER_BYTE,
  MAX_BATCH,
  TOKEN_OUTPUT_SATS,
} from './constants.js';
import { encodeMemo, type MemoKind } from './memo.js';
import { hashBatch } from './request.js';
import type { Amount, InputPath, Network, SpendableUtxo, TokenAmount } from './types.js';

/**
 * One entry per input, in input order: a libauth Input merged with the libauth Output it spends.
 * This is the WalletConnect-BCH / CashScript `WcSourceOutput` convention, which WizardConnect's
 * `signTransaction({ transaction, sourceOutputs })` follows.
 */
export type SourceOutput = Input & Output;

export interface PaymentSpec {
  vendor: string;
  amount: Amount;
  requestHash: Uint8Array;
}

export interface BuildPaymentParams {
  network: Network;
  payments: PaymentSpec[];
  utxos: SpendableUtxo[];
  changeAddress: string;
  /** Override the memo hash (memo kind still follows the payment count). */
  memoHash?: Uint8Array;
}

export interface BuiltPayment {
  txHex: string;
  /** The unsigned transaction as a libauth object (what signTransaction takes alongside sourceOutputs). */
  transaction: TransactionCommon;
  sourceOutputs: SourceOutput[];
  inputPaths: InputPath[];
  fee: bigint;
  memo: { kind: MemoKind; hash: Uint8Array };
}

/** Upper bound for a P2PKH unlocking bytecode (ECDSA sig 72 + sighash 1 + pubkey 33 + 2 push opcodes). */
const P2PKH_UNLOCKING_BYTES = 108;

const isTokenAmount = (a: Amount): a is TokenAmount => typeof (a as TokenAmount).token === 'string';

const decodeAddress = (address: string, network: Network, label: string) => {
  const decoded = cashAddressToLockingBytecode(address);
  if (typeof decoded === 'string') throw new Error(`Invalid ${label} address ${address}: ${decoded}`);
  if (decoded.prefix !== CASHADDR_PREFIX[network]) {
    throw new Error(`${label} address ${address} is not a ${network} address (expected prefix ${CASHADDR_PREFIX[network]}:)`);
  }
  return decoded;
};

const parseUnits = (units: string): bigint => {
  if (!/^\d+$/.test(units)) throw new Error(`Invalid token units "${units}"`);
  const v = BigInt(units);
  if (v <= 0n) throw new Error('Token amount must be greater than zero');
  return v;
};

/** Estimated serialized size once every input is signed. */
const estimateSize = (tx: TransactionCommon): bigint =>
  BigInt(encodeTransaction(tx).length + tx.inputs.length * P2PKH_UNLOCKING_BYTES);

export function buildPayment(params: BuildPaymentParams): BuiltPayment {
  const { network, payments, utxos, changeAddress } = params;

  if (!Array.isArray(payments) || payments.length === 0) throw new Error('At least one payment is required');
  if (payments.length > MAX_BATCH) throw new Error(`Too many payments: ${payments.length} (max ${MAX_BATCH})`);

  const changeLocking = decodeAddress(changeAddress, network, 'Change').bytecode;

  // ---- Payment outputs ----
  const paymentOutputs: Output[] = [];
  const tokensNeeded = new Map<string, bigint>(); // category hex (lowercase) -> units
  for (const [i, p] of payments.entries()) {
    const vendor = decodeAddress(p.vendor, network, `Vendor (payment ${i})`);
    if (!(p.requestHash instanceof Uint8Array) || p.requestHash.length !== 32) {
      throw new Error(`Payment ${i}: requestHash must be 32 bytes`);
    }
    if (isTokenAmount(p.amount)) {
      const category = p.amount.token.toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(category)) throw new Error(`Payment ${i}: invalid token category`);
      if (!vendor.tokenSupport) {
        throw new Error(`Payment ${i}: vendor address ${p.vendor} is not token-aware; token payments need a token-aware address`);
      }
      const units = parseUnits(p.amount.units);
      tokensNeeded.set(category, (tokensNeeded.get(category) ?? 0n) + units);
      paymentOutputs.push({
        lockingBytecode: vendor.bytecode,
        valueSatoshis: TOKEN_OUTPUT_SATS,
        token: { category: hexToBin(category), amount: units },
      });
    } else {
      const sats = p.amount.sats;
      if (!Number.isSafeInteger(sats) || sats <= 0) throw new Error(`Payment ${i}: invalid sats amount ${sats}`);
      if (BigInt(sats) < DUST_SATS) {
        throw new Error(`Payment ${i}: ${sats} sats is below the dust limit (${DUST_SATS})`);
      }
      paymentOutputs.push({ lockingBytecode: vendor.bytecode, valueSatoshis: BigInt(sats) });
    }
  }

  // ---- Memo ----
  const kind: MemoKind = payments.length === 1 ? 'single' : 'batch';
  const memoHash =
    params.memoHash ?? (kind === 'single' ? payments[0]!.requestHash : hashBatch(payments.map((p) => p.requestHash)));
  const memoOutput: Output = { lockingBytecode: encodeMemo(kind, memoHash), valueSatoshis: 0n };

  // ---- Coin selection: tokens ----
  const selected: SpendableUtxo[] = [];
  const isPlainBch = (u: SpendableUtxo) => !u.token;
  for (const [category, need] of tokensNeeded) {
    const candidates = utxos
      .filter((u) => u.token && !u.token.nft && u.token.category.toLowerCase() === category)
      .sort((a, b) => (b.token!.amount > a.token!.amount ? 1 : b.token!.amount < a.token!.amount ? -1 : 0));
    let have = 0n;
    for (const u of candidates) {
      if (have >= need) break;
      selected.push(u);
      have += u.token!.amount;
    }
    if (have < need) {
      throw new Error(`Insufficient tokens of category ${category}: need ${need}, have ${have}`);
    }
  }

  const tokenChangeOutputs = (): Output[] => {
    const outs: Output[] = [];
    for (const [category, need] of tokensNeeded) {
      const have = selected
        .filter((u) => u.token && u.token.category.toLowerCase() === category)
        .reduce((s, u) => s + u.token!.amount, 0n);
      if (have > need) {
        outs.push({
          lockingBytecode: changeLocking,
          valueSatoshis: TOKEN_OUTPUT_SATS,
          token: { category: hexToBin(category), amount: have - need },
        });
      }
    }
    return outs;
  };

  const toInput = (u: SpendableUtxo): Input => ({
    outpointIndex: u.vout,
    outpointTransactionHash: hexToBin(u.txid),
    sequenceNumber: 0xffffffff,
    unlockingBytecode: new Uint8Array(),
  });

  const makeTx = (outputs: Output[]): TransactionCommon => ({
    version: 2,
    locktime: 0,
    inputs: selected.map(toInput),
    outputs,
  });

  // ---- Coin selection: sats (largest first) ----
  const bchPool = utxos.filter(isPlainBch).sort((a, b) => (b.satoshis > a.satoshis ? 1 : b.satoshis < a.satoshis ? -1 : 0));
  const sum = (xs: Output[]) => xs.reduce((s, o) => s + o.valueSatoshis, 0n);

  for (;;) {
    const fixedOutputs = [...paymentOutputs, memoOutput, ...tokenChangeOutputs()];
    const inSats = selected.reduce((s, u) => s + u.satoshis, 0n);
    const outSats = sum(fixedOutputs);

    // Try with a BCH change output first.
    const changeOutput: Output = { lockingBytecode: changeLocking, valueSatoshis: 0n };
    const feeWithChange = estimateSize(makeTx([...fixedOutputs, changeOutput])) * FEE_SATS_PER_BYTE;
    const change = inSats - outSats - feeWithChange;
    if (change >= DUST_SATS) {
      changeOutput.valueSatoshis = change;
      return finish(makeTx([...fixedOutputs, changeOutput]), outSats + change);
    }
    // Otherwise without change; leftover (< dust) goes to the fee.
    const feeNoChange = estimateSize(makeTx(fixedOutputs)) * FEE_SATS_PER_BYTE;
    if (inSats - outSats >= feeNoChange && selected.length > 0) {
      return finish(makeTx(fixedOutputs), outSats);
    }

    const next = bchPool.find((u) => !selected.includes(u));
    if (!next) {
      throw new Error(
        `Insufficient funds: need about ${outSats + feeNoChange} sats (outputs ${outSats} + fee ${feeNoChange}), have ${inSats + bchPool.filter((u) => !selected.includes(u)).reduce((s, u) => s + u.satoshis, 0n)} spendable`,
      );
    }
    selected.push(next);
  }

  function finish(transaction: TransactionCommon, totalOut: bigint): BuiltPayment {
    const inSats = selected.reduce((s, u) => s + u.satoshis, 0n);
    const sourceOutputs: SourceOutput[] = selected.map((u, i) => ({
      ...transaction.inputs[i]!,
      lockingBytecode: hexToBin(u.lockingBytecode),
      valueSatoshis: u.satoshis,
      ...(u.token
        ? {
            token: {
              category: hexToBin(u.token.category),
              amount: u.token.amount,
              ...(u.token.nft
                ? { nft: { capability: u.token.nft.capability, commitment: hexToBin(u.token.nft.commitment) } }
                : {}),
            },
          }
        : {}),
    })) as SourceOutput[];
    const inputPaths: InputPath[] = selected.map((u, i) => [i, u.path[0], u.path[1]]);
    return {
      txHex: binToHex(encodeTransaction(transaction)),
      transaction,
      sourceOutputs,
      inputPaths,
      fee: inSats - totalOut,
      memo: { kind, hash: memoHash },
    };
  }
}
