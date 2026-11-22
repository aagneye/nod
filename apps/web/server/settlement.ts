/**
 * Shared steps of the pay, receipt and vendor routes: reading signed terms from a request body,
 * proving a payment (HSP says paid + the token transfer is on chain), and NodReceipts reads and
 * anchoring on HSK Chain.
 */
import {
  checkSettlement,
  decodeLink,
  explorerTxUrl,
  findChain,
  hashTerms,
  parseSignedTerms,
  readReceipt,
  usdToRaw,
  verifyTerms,
  type HspPaymentOption,
  type HspPaymentStatus,
  type NodReceipt,
  type SignedTerms,
} from '@nod/protocol';
import type { Address, Hash, Hex } from 'viem';
import type { ChainReader } from './chain.js';
import { merchantNameFor } from './config.js';
import type { ApiContext } from './context.js';
import { optionForNetwork, paymentOptions, queryPayment } from './hsp-flow.js';
import { HttpError, errorMessage, optionalString, requireAddress, type JsonObject } from './http.js';
import type { AnchorResult, ReceiptJson, SettlementCheckJson } from './types.js';

// ---------------------------------------------------------------------------
// Terms from a request body
// ---------------------------------------------------------------------------

export interface BodyTerms {
  signed: SignedTerms;
  termsHash: Hex;
  expired: boolean;
}

/**
 * `payload` (a link, `#payload` or the bare payload) or `signed` ({ terms, sig }), verified:
 * 400 invalid_terms for a bad shape or signature, 400 expired for expired terms unless
 * `allowExpired` (a payment authorized before the expiry can still be settled and redeemed).
 */
export async function termsFromBody(body: JsonObject, opts: { allowExpired: boolean }): Promise<BodyTerms> {
  let signed: SignedTerms;
  if (typeof body.payload === 'string' && body.payload.trim() !== '') {
    try {
      signed = decodeLink(body.payload);
    } catch (error) {
      throw new HttpError(400, errorMessage(error), 'invalid_terms');
    }
  } else if (body.signed !== undefined && body.signed !== null) {
    try {
      signed = parseSignedTerms(body.signed);
    } catch (error) {
      throw new HttpError(400, errorMessage(error), 'invalid_terms');
    }
  } else {
    throw new HttpError(400, 'Send the terms as payload (the link or its #payload part) or as signed ({ terms, sig })', 'bad_request');
  }
  const verification = await verifyTerms(signed);
  const signatureOk = verification.recovered.toLowerCase() === signed.terms.agent.toLowerCase();
  if (!verification.valid) {
    if (verification.expired && signatureOk) {
      if (!opts.allowExpired) throw new HttpError(400, verification.reason ?? 'These terms have expired', 'expired');
    } else {
      throw new HttpError(400, verification.reason ?? 'Invalid terms', 'invalid_terms');
    }
  }
  return { signed, termsHash: hashTerms(signed.terms), expired: verification.expired };
}

/** NOD_MERCHANT_NAME (or the mock placeholder); 503 not_configured when unset in live mode. */
export function requireMerchantName(ctx: ApiContext): string {
  const name = merchantNameFor(ctx.cfg, ctx.hsp.mode);
  if (!name) {
    throw new HttpError(
      503,
      "NOD_MERCHANT_NAME is not set: HSP needs the team's reporting name on every order and status query.",
      'not_configured',
    );
  }
  return name;
}

export interface PaymentIds {
  flowId?: string;
  paymentRequestId?: string;
}

/** flowId and/or paymentRequestId from a body or query; 400 when both are missing. */
export function requireIds(source: { flowId?: unknown; paymentRequestId?: unknown }): PaymentIds {
  const flowId = optionalString(source.flowId, 'flowId', 256);
  const paymentRequestId = optionalString(source.paymentRequestId, 'paymentRequestId', 256);
  if (!flowId && !paymentRequestId) throw new HttpError(400, 'flowId or paymentRequestId is required', 'bad_request');
  return { ...(flowId ? { flowId } : {}), ...(paymentRequestId ? { paymentRequestId } : {}) };
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

export function receiptJson(receipt: NodReceipt): ReceiptJson {
  const chainId = Number(receipt.chainId);
  const url = findChain(chainId) ? explorerTxUrl(chainId, receipt.settlementTx) : undefined;
  return {
    settlementTx: receipt.settlementTx,
    chainId,
    payer: receipt.payer,
    payTo: receipt.payTo,
    amount: receipt.amount.toString(),
    anchoredAt: Number(receipt.anchoredAt),
    ...(url ? { settlementExplorerUrl: url } : {}),
  };
}

/** The receipt `recorder` anchored for `termsHash` on the configured NodReceipts, or null. Throws on RPC errors. */
export async function readAnchoredReceipt(ctx: ApiContext, termsHash: Hex, recorder: Address): Promise<ReceiptJson | null> {
  const { receipts } = ctx.cfg;
  if (!receipts.address) return null;
  const receipt = await readReceipt(ctx.chains.reader(receipts.chainId), receipts.address, recorder, termsHash);
  return receipt ? receiptJson(receipt) : null;
}

/** Our recorder's receipt for `termsHash`, or null (also when unconfigured or the read fails). */
export async function findPriorReceipt(ctx: ApiContext, termsHash: Hex): Promise<ReceiptJson | null> {
  const { receipts } = ctx.cfg;
  if (!receipts.address || !receipts.recorder) return null;
  try {
    return await readAnchoredReceipt(ctx, termsHash, receipts.recorder);
  } catch (error) {
    ctx.log.warn(`could not check NodReceipts for ${termsHash}: ${errorMessage(error)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Proving a payment
// ---------------------------------------------------------------------------

export interface PaymentProof {
  status: HspPaymentStatus;
  /** HSP reports payment-safe or payment-finalized. */
  paid: boolean;
  check: SettlementCheckJson;
  option?: HspPaymentOption;
  payer?: Address;
  transferredRaw?: bigint;
}

const MOCK_CHECK: SettlementCheckJson = { ok: true, reasons: [], skipped: true, reason: 'mock mode' };

/**
 * Ask HSP for the payment status; when paid, check the settlement transaction on the payment
 * network (PROTOCOL §2 "Payment check"). In mock mode the on-chain check is skipped.
 */
export async function provePayment(ctx: ApiContext, signed: SignedTerms, ids: PaymentIds, payerHint?: Address): Promise<PaymentProof> {
  const merchantName = requireMerchantName(ctx);
  const status = await queryPayment(ctx, { ...ids, merchantName });
  if (status.outcome !== 'paid') {
    const reason = status.statusReason ? ` (${status.statusReason})` : '';
    return { status, paid: false, check: { ok: false, reasons: [`HSP reports ${status.status}${reason}`] } };
  }
  if (ctx.hsp.mode === 'mock') return { status, paid: true, check: { ...MOCK_CHECK }, ...(status.payer ? { payer: status.payer } : {}) };

  const { terms } = signed;
  const reasons: string[] = [];
  const payer = status.payer ?? payerHint;
  if (!status.txHash) reasons.push('HSP reported no settlement transaction (payment.tx_signature)');
  if (!payer) reasons.push('HSP did not report the payer address');
  if (status.payTo && status.payTo.toLowerCase() !== terms.payTo.toLowerCase()) {
    reasons.push(`HSP paid ${status.payTo}, but the terms pay ${terms.payTo}`);
  }
  const option = optionForNetwork(await paymentOptions(ctx), status.network, ctx.cfg.hsp.prefer);
  if (reasons.length > 0 || !status.txHash || !payer) return { status, paid: true, check: { ok: false, reasons }, option };

  let minRaw: bigint;
  try {
    minRaw = usdToRaw(terms.amountUsd, option.decimals);
  } catch (error) {
    return { status, paid: true, check: { ok: false, reasons: [errorMessage(error)] }, option, payer };
  }
  let reader: ChainReader;
  try {
    reader = ctx.chains.reader(option.chainId);
  } catch (error) {
    return { status, paid: true, check: { ok: false, reasons: [errorMessage(error)] }, option, payer };
  }
  const result = await checkSettlement({
    client: reader,
    txHash: status.txHash,
    token: option.contractAddress,
    payer,
    payTo: terms.payTo,
    minRaw,
  });
  const check: SettlementCheckJson = {
    ok: result.ok,
    reasons: result.reasons,
    ...(result.transferredRaw !== undefined ? { transferredRaw: result.transferredRaw.toString() } : {}),
  };
  return {
    status,
    paid: true,
    check,
    option,
    payer,
    ...(result.transferredRaw !== undefined ? { transferredRaw: result.transferredRaw } : {}),
  };
}

// ---------------------------------------------------------------------------
// Anchoring
// ---------------------------------------------------------------------------

/** How long settle waits for the anchor transaction to be mined before answering `pending: true`. */
export const ANCHOR_WAIT_MS = 20_000;

export interface AnchorInput {
  termsHash: Hex;
  settlementTx: Hash;
  /** Chain id of the payment network. */
  chainId: number;
  payer: Address;
  payTo: Address;
  amount: bigint;
}

/**
 * Anchor `termsHash → settlement` in NodReceipts from the recorder key. Idempotent: an existing
 * receipt (ours) is returned as `{ already: true }`. Skipped in mock mode or without a contract
 * or recorder key. Throws when sending fails.
 */
export async function anchorSettlement(ctx: ApiContext, input: AnchorInput): Promise<AnchorResult> {
  const { receipts } = ctx.cfg;
  if (ctx.hsp.mode === 'mock') return { skipped: true, reason: 'mock mode' };
  if (!receipts.address) return { skipped: true, reason: 'NOD_RECEIPTS_ADDRESS is not set' };
  if (!receipts.recorderKey || !receipts.recorder) return { skipped: true, reason: 'NOD_RECORDER_KEY is not set' };

  const existing = await readAnchoredReceipt(ctx, input.termsHash, receipts.recorder);
  if (existing) return { already: true, receipt: existing };

  let txHash: Hash;
  try {
    txHash = await ctx.chains.anchor({
      chainId: receipts.chainId,
      contract: receipts.address,
      privateKey: receipts.recorderKey,
      args: {
        termsHash: input.termsHash,
        settlementTx: input.settlementTx,
        chainId: input.chainId,
        payer: input.payer,
        payTo: input.payTo,
        amount: input.amount,
      },
    });
  } catch (error) {
    // Another request anchored it first.
    if (/AlreadyAnchored/.test(errorMessage(error)) || /AlreadyAnchored/.test(String((error as { message?: unknown })?.message))) {
      const receipt = await readAnchoredReceipt(ctx, input.termsHash, receipts.recorder);
      if (receipt) return { already: true, receipt };
    }
    throw error;
  }
  ctx.log.info(`anchored ${input.termsHash} in tx ${txHash}`);

  const explorerUrl = explorerTxUrl(receipts.chainId, txHash);
  try {
    const mined = await ctx.chains.reader(receipts.chainId).waitForTransactionReceipt({ hash: txHash, timeout: ANCHOR_WAIT_MS });
    if (mined.status !== 'success') throw new Error(`The anchor transaction ${txHash} reverted`);
  } catch (error) {
    if (/reverted/.test(errorMessage(error))) throw error;
    ctx.log.warn(`anchor ${txHash} not confirmed yet: ${errorMessage(error)}`);
    return { txHash, explorerUrl, pending: true };
  }
  return { txHash, explorerUrl };
}

/** A payer address from an optional body field (fallback when HSP does not report one). */
export function optionalPayer(value: unknown): Address | undefined {
  return value === undefined || value === null || value === '' ? undefined : requireAddress(value, 'payer');
}
