/**
 * /api/pay/*: one human-approved payment through HSP (PROTOCOL §2).
 *   start   verify terms → get_chain_config → create_order → prepare_payment
 *   finish  finalize_payment + submit_payment with the payer's signature
 *   status  query_payment
 *   settle  HSP paid + on-chain transfer check → anchor the receipt in NodReceipts
 */
import { buildCartMandate, explorerTxUrl, findChain, type CartMandate, type HspPrepared } from '@nod/protocol';
import type { ApiContext } from '../context.js';
import {
  cachedPaymentOptions,
  chainIdForNetwork,
  createOrder,
  finalizePayment,
  paymentOptions,
  pickOption,
  preparePayment,
  queryPayment,
  submitPayment,
} from '../hsp-flow.js';
import { HttpError, errorMessage, isJsonObject, json, readJsonBody, requireAddress, requireString } from '../http.js';
import {
  anchorSettlement,
  findPriorReceipt,
  optionalPayer,
  provePayment,
  requireIds,
  requireMerchantName,
  termsFromBody,
} from '../settlement.js';
import type { AnchorResult, HspOpaque, PayFinishResponse, PayStartResponse, PayStatusResponse, SettleResponse } from '../types.js';

// ---------------------------------------------------------------------------
// POST /api/pay/start
// ---------------------------------------------------------------------------

/** The prepared authorization must pay the terms' recipient from the connected payer. */
function checkPrepared(prepared: HspPrepared, expected: { payTo: string; payer: string; chainId: number }, ctx: ApiContext): void {
  if (prepared.payTo && prepared.payTo.toLowerCase() !== expected.payTo.toLowerCase()) {
    throw new HttpError(502, `HSP prepared a payment to ${prepared.payTo}, but the terms pay ${expected.payTo}`, 'hsp_mismatch');
  }
  if (prepared.payer && prepared.payer.toLowerCase() !== expected.payer.toLowerCase()) {
    throw new HttpError(502, `HSP prepared a payment from ${prepared.payer}, but the payer is ${expected.payer}`, 'hsp_mismatch');
  }
  if (prepared.chainId !== undefined && prepared.chainId !== expected.chainId) {
    ctx.log.warn(`prepare_payment signs on chain ${prepared.chainId}, the chosen option is on chain ${expected.chainId}`);
  }
}

export async function handlePayStart(ctx: ApiContext): Promise<Response> {
  const body = await readJsonBody(ctx.request);
  const { signed, termsHash } = await termsFromBody(body, { allowExpired: false });
  const payer = requireAddress(body.payer, 'payer');
  const merchantName = requireMerchantName(ctx);
  const { terms } = signed;

  const prior = await findPriorReceipt(ctx, termsHash);
  if (prior) throw new HttpError(409, 'These terms were already paid', 'already_paid', { receipt: prior });

  const option = pickOption(await paymentOptions(ctx), ctx.cfg.hsp.prefer);
  let cart: CartMandate;
  try {
    cart = buildCartMandate({ terms, termsHash, option, merchantName });
  } catch (error) {
    throw new HttpError(400, errorMessage(error), 'invalid_terms');
  }
  const order = await createOrder(ctx, { merchantName, payTo: terms.payTo, cart });
  const prepared = await preparePayment(ctx, { flowId: order.flowId, payer, protocol: option.paymentProtocol });
  checkPrepared(prepared, { payTo: terms.payTo, payer, chainId: option.chainId }, ctx);

  const response: PayStartResponse = {
    flowId: order.flowId,
    paymentRequestId: prepared.paymentRequestId ?? order.paymentRequestId,
    termsHash,
    payTo: terms.payTo,
    payer,
    eip712: prepared.eip712,
    tokenTotalRaw: prepared.tokenTotalRaw.toString(),
    quoteExpiresAt: prepared.quoteExpiresAt ?? null,
    option,
    opaque: prepared.opaque,
  };
  return json(200, response);
}

// ---------------------------------------------------------------------------
// POST /api/pay/finish
// ---------------------------------------------------------------------------

function requireOpaque(value: unknown): HspOpaque {
  if (!isJsonObject(value)) throw new HttpError(400, 'opaque (from /api/pay/start) is required', 'bad_request');
  const missing = (['payment_payload', 'payment_mandate_contents', 'cart_hash'] as const).filter(
    (key) => value[key] === undefined || value[key] === null,
  );
  if (missing.length > 0) throw new HttpError(400, `opaque is missing ${missing.join(', ')}`, 'bad_request');
  return { payment_payload: value.payment_payload, payment_mandate_contents: value.payment_mandate_contents, cart_hash: value.cart_hash };
}

export async function handlePayFinish(ctx: ApiContext): Promise<Response> {
  const body = await readJsonBody(ctx.request);
  const flowId = requireString(body.flowId, 'flowId', 256);
  const paymentRequestId = requireString(body.paymentRequestId, 'paymentRequestId', 256);
  const signature = requireString(body.signature, 'signature', 200);
  if (!/^0x([0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/.test(signature)) {
    throw new HttpError(400, 'signature must be the wallet signature: 0x followed by 130 hex characters', 'bad_request');
  }
  const opaque = requireOpaque(body.opaque);

  const paymentMandateJson = await finalizePayment(ctx, { flowId, signature, opaque });
  const status = await submitPayment(ctx, { flowId, paymentMandateJson });
  const response: PayFinishResponse = { status, flowId, paymentRequestId };
  return json(200, response);
}

// ---------------------------------------------------------------------------
// GET /api/pay/status
// ---------------------------------------------------------------------------

export async function handlePayStatus(ctx: ApiContext): Promise<Response> {
  const params = ctx.url.searchParams;
  const ids = requireIds({ flowId: params.get('flowId') ?? undefined, paymentRequestId: params.get('paymentRequestId') ?? undefined });
  const merchantName = requireMerchantName(ctx);
  const status = await queryPayment(ctx, { ...ids, merchantName });

  let options = cachedPaymentOptions(ctx);
  if (options.length === 0 && status.network) options = await paymentOptions(ctx).catch(() => []);
  const chainId = chainIdForNetwork(status.network, options);
  const response: PayStatusResponse = {
    status: status.status,
    outcome: status.outcome === 'paid' || status.outcome === 'failed' ? status.outcome : 'pending',
    ...(status.txHash ? { txHash: status.txHash } : {}),
    ...(chainId !== undefined ? { chainId } : {}),
    ...(status.network ? { network: status.network } : {}),
    ...(status.payer ? { payer: status.payer } : {}),
    ...(status.payTo ? { payTo: status.payTo } : {}),
    ...(status.attributionVerified !== undefined ? { attributionVerified: status.attributionVerified } : {}),
    ...(status.statusReason ? { statusReason: status.statusReason } : {}),
    ...(status.txHash && chainId !== undefined && findChain(chainId) ? { explorerUrl: explorerTxUrl(chainId, status.txHash) } : {}),
  };
  return json(200, response);
}

// ---------------------------------------------------------------------------
// POST /api/pay/settle
// ---------------------------------------------------------------------------

export async function handlePaySettle(ctx: ApiContext): Promise<Response> {
  const body = await readJsonBody(ctx.request);
  const { signed, termsHash } = await termsFromBody(body, { allowExpired: true });
  const ids = requireIds(body);
  const proof = await provePayment(ctx, signed, ids, optionalPayer(body.payer));

  if (!proof.paid) {
    throw new HttpError(409, `Not paid yet: ${proof.check.reasons.join('; ')}`, 'not_paid', { status: proof.status.status });
  }
  if (!proof.check.ok) {
    const response: SettleResponse = { ok: false, check: proof.check, anchor: { skipped: true, reason: 'settlement check failed' } };
    return json(409, { ...response, error: `Settlement check failed: ${proof.check.reasons.join('; ')}`, code: 'settlement_check_failed' });
  }

  let anchor: AnchorResult;
  if (ctx.hsp.mode === 'mock' || !proof.option || !proof.status.txHash || !proof.payer) {
    anchor = { skipped: true, reason: ctx.hsp.mode === 'mock' ? 'mock mode' : 'no settlement details to anchor' };
  } else {
    try {
      anchor = await anchorSettlement(ctx, {
        termsHash,
        settlementTx: proof.status.txHash,
        chainId: proof.option.chainId,
        payer: proof.payer,
        payTo: signed.terms.payTo,
        amount: proof.transferredRaw ?? 0n,
      });
    } catch (error) {
      ctx.log.error(`anchoring ${termsHash} failed: ${errorMessage(error)}`);
      anchor = { skipped: true, failed: true, reason: `Anchoring failed: ${errorMessage(error)}` };
    }
  }
  const response: SettleResponse = { ok: true, check: proof.check, anchor };
  return json(200, response);
}
