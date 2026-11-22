import { usdToRaw } from '@nod/protocol';
import type { PayStartResponse, PaymentOption, TypedDataPayload } from './api';
import { toUnixSeconds } from './format';

/** An HSP quote ready to sign: /api/pay/start's answer, checked and normalized. */
export interface Quote {
  flowId: string;
  paymentRequestId: string;
  termsHash: string;
  payTo: string;
  payer: string;
  eip712: TypedDataPayload;
  /** Token base units (exact decimal string). */
  tokenTotalRaw: string;
  /** Unix seconds; undefined when HSP did not say. */
  quoteExpiresAt?: number;
  option: PaymentOption;
  opaque: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function readTypedData(value: unknown): TypedDataPayload {
  if (
    !isRecord(value) ||
    !isRecord(value.domain) ||
    !isRecord(value.types) ||
    typeof value.primaryType !== 'string' ||
    !isRecord(value.message)
  ) {
    throw new Error('HSP did not return a payment authorization to sign. Please try again.');
  }
  return value as unknown as TypedDataPayload;
}

export function toQuote(res: PayStartResponse): Quote {
  if (!res.flowId || !res.paymentRequestId) throw new Error('HSP did not return a payment flow. Please try again.');
  const raw = String(res.tokenTotalRaw ?? '');
  if (!/^\d+$/.test(raw)) throw new Error('HSP did not return a token amount. Please try again.');
  if (!res.option || typeof res.option.decimals !== 'number') {
    throw new Error('HSP did not say which token it settles in. Please try again.');
  }
  return {
    flowId: res.flowId,
    paymentRequestId: res.paymentRequestId,
    termsHash: res.termsHash,
    payTo: res.payTo,
    payer: res.payer,
    eip712: readTypedData(res.eip712),
    tokenTotalRaw: raw,
    quoteExpiresAt: toUnixSeconds(res.quoteExpiresAt),
    option: res.option,
    opaque: res.opaque,
  };
}

const sameAddress = (a: string | undefined, b: string | undefined): boolean =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

export interface QuoteChecks {
  /** HSP pays the address the agent signed for. */
  payToMatches: boolean;
  /** The quote was prepared for the wallet that is connected now. */
  payerMatches: boolean;
  /** Base units the terms ask for, in the quote's token; undefined if not representable. */
  expectedRaw?: bigint;
  /** Quote amount equals the terms' USD amount, unit for unit. */
  amountMatches: boolean;
}

export function checkQuote(quote: Quote, terms: { payTo: string; amountUsd: string }, wallet: string | null): QuoteChecks {
  let expectedRaw: bigint | undefined;
  try {
    expectedRaw = usdToRaw(terms.amountUsd, quote.option.decimals);
  } catch {
    expectedRaw = undefined;
  }
  return {
    payToMatches: !quote.payTo || sameAddress(quote.payTo, terms.payTo),
    // A disconnected wallet counts as a mismatch: the page then offers a fresh quote, which reconnects.
    payerMatches: !quote.payer || (wallet !== null && sameAddress(quote.payer, wallet)),
    expectedRaw,
    amountMatches: expectedRaw !== undefined && BigInt(quote.tokenTotalRaw) === expectedRaw,
  };
}

/** Two quotes ask the payer for the same thing (used to re-sign after an expired quote without a new review). */
export const sameAsk = (a: Quote, b: Quote): boolean =>
  a.tokenTotalRaw === b.tokenTotalRaw &&
  sameAddress(a.payTo, b.payTo) &&
  sameAddress(a.payer, b.payer) &&
  a.option.contractAddress.toLowerCase() === b.option.contractAddress.toLowerCase() &&
  a.option.chainId === b.option.chainId;
