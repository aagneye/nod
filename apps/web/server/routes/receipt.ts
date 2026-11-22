/**
 * GET /api/receipt?termsHash=0x…[&recorder=0x…]: the NodReceipts receipt anchored for these
 * terms by our recorder (or the given one), with explorer links.
 */
import { explorerAddressUrl } from '@nod/protocol';
import type { Hex } from 'viem';
import type { ApiContext } from '../context.js';
import { HttpError, errorMessage, json, requireAddress } from '../http.js';
import { readAnchoredReceipt } from '../settlement.js';
import type { ReceiptJson, ReceiptResponse } from '../types.js';

export async function handleReceipt(ctx: ApiContext): Promise<Response> {
  const params = ctx.url.searchParams;
  const termsHash = (params.get('termsHash') ?? '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(termsHash)) {
    throw new HttpError(400, 'termsHash must be 0x followed by 64 hex characters', 'bad_request');
  }
  const hash = termsHash.toLowerCase() as Hex;
  const { receipts } = ctx.cfg;
  const recorderParam = params.get('recorder');
  const recorder = recorderParam ? requireAddress(recorderParam, 'recorder') : receipts.recorder;

  const explorer: ReceiptResponse['explorer'] = {
    ...(receipts.address ? { contract: explorerAddressUrl(receipts.chainId, receipts.address) } : {}),
    ...(recorder ? { recorder: explorerAddressUrl(receipts.chainId, recorder) } : {}),
  };
  const base = { termsHash: hash, chainId: receipts.chainId, contract: receipts.address, recorder: recorder ?? null };

  if (!receipts.address || !recorder) {
    const reason = !receipts.address ? 'NOD_RECEIPTS_ADDRESS is not set' : 'No recorder: set NOD_RECORDER_KEY or NOD_RECORDER_ADDRESS';
    const response: ReceiptResponse = { anchored: false, ...base, explorer, reason };
    return json(200, response);
  }

  let receipt: ReceiptJson | null;
  try {
    receipt = await readAnchoredReceipt(ctx, hash, recorder);
  } catch (error) {
    throw new HttpError(502, `Could not read NodReceipts on chain ${receipts.chainId}: ${errorMessage(error)}`, 'chain_unavailable');
  }
  const response: ReceiptResponse = receipt
    ? {
        anchored: true,
        ...base,
        receipt,
        explorer: { ...explorer, ...(receipt.settlementExplorerUrl ? { settlementTx: receipt.settlementExplorerUrl } : {}) },
      }
    : { anchored: false, ...base, explorer };
  return json(200, response);
}
