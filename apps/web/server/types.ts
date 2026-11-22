/**
 * JSON shapes of the /api routes (the HTTP contract the web app codes against).
 * Every error is `ApiError` with an HTTP status >= 400. Bigints travel as decimal strings.
 */
import type { HspEip712, HspPaymentOption, SignedTerms } from '@nod/protocol';
import type { Address, Hash, Hex } from 'viem';

export interface ApiError {
  error: string;
  /**
   * Machine-readable reason: bad_request, invalid_terms, expired, already_paid, not_configured,
   * hsp_unavailable (503), hsp_error (502), no_payment_option, hsp_mismatch, quote_expired (409),
   * not_paid (409), settlement_check_failed (409), not_demo_vendor, chain_unavailable,
   * config_error, not_found, method_not_allowed.
   */
  code?: string;
}

/** GET /api/config */
export interface ConfigResponse {
  receipts: { chainId: number; address: Address | null; recorder: Address | null; explorer: string };
  policy: { chainId: number; address: Address | null };
  hsp: {
    mode: 'live' | 'mock';
    /** NOD_MERCHANT_NAME (a placeholder in mock mode); null when unset in live mode. */
    merchantName: string | null;
    /** get_chain_config answered (cached for 5 minutes). */
    reachable: boolean;
    error?: string;
    /** The token and network payments will use. */
    option?: HspPaymentOption;
  };
  demoUsd: string;
}

/** GET /api/demo-agent */
export interface DemoAgentResponse {
  link: string;
  signed: SignedTerms;
  termsHash: Hex;
  /** "ephemeral agent key" when NOD_DEMO_AGENT_KEY is unset. */
  warning?: string;
}

/** The values finalize_payment needs unchanged; the client sends them back to /api/pay/finish. */
export interface HspOpaque {
  payment_payload: unknown;
  payment_mandate_contents: unknown;
  cart_hash: unknown;
}

/** POST /api/pay/start { payload | signed, payer } */
export interface PayStartResponse {
  flowId: string;
  paymentRequestId: string;
  termsHash: Hex;
  payTo: Address;
  payer: Address;
  /** Sign unchanged with eth_signTypedData_v4, with the wallet on eip712.domain.chainId. */
  eip712: HspEip712;
  /** Token base units the payer authorizes (decimal string). */
  tokenTotalRaw: string;
  /** Unix seconds; null when HSP did not say. */
  quoteExpiresAt: number | null;
  option: HspPaymentOption;
  opaque: HspOpaque;
}

/** POST /api/pay/finish { flowId, paymentRequestId, signature, opaque } */
export interface PayFinishResponse {
  status: string;
  flowId: string;
  paymentRequestId: string;
}

/** GET /api/pay/status?flowId=&paymentRequestId= */
export interface PayStatusResponse {
  status: string;
  outcome: 'pending' | 'paid' | 'failed';
  txHash?: Hash;
  chainId?: number;
  network?: string;
  payer?: Address;
  payTo?: Address;
  attributionVerified?: boolean;
  statusReason?: string;
  explorerUrl?: string;
}

/** A NodReceipts receipt as JSON. */
export interface ReceiptJson {
  settlementTx: Hex;
  /** Chain id of the payment network. */
  chainId: number;
  payer: Address;
  payTo: Address;
  /** Token base units (decimal string). */
  amount: string;
  /** Unix seconds. */
  anchoredAt: number;
  /** Explorer page of the settlement transaction, when the chain is known. */
  settlementExplorerUrl?: string;
}

export interface SettlementCheckJson {
  ok: boolean;
  reasons: string[];
  /** Token base units of the matching Transfer (decimal string). */
  transferredRaw?: string;
  /** True in mock mode: nothing was checked on chain. */
  skipped?: boolean;
  reason?: string;
}

export type AnchorResult =
  | { txHash: Hash; explorerUrl: string; /** Broadcast, but not mined within the wait. */ pending?: boolean }
  | { already: true; receipt: ReceiptJson }
  | { skipped: true; reason: string; /** The anchor transaction was attempted and failed. */ failed?: boolean };

/** POST /api/pay/settle { payload | signed, flowId, paymentRequestId, payer? } */
export interface SettleResponse {
  ok: boolean;
  check: SettlementCheckJson;
  anchor: AnchorResult;
}

/** GET /api/receipt?termsHash=0x…[&recorder=0x…] */
export interface ReceiptResponse {
  anchored: boolean;
  termsHash: Hex;
  /** Chain of the NodReceipts contract. */
  chainId: number;
  contract: Address | null;
  recorder: Address | null;
  receipt?: ReceiptJson;
  explorer: { contract?: string; recorder?: string; settlementTx?: string };
  /** Why nothing could be looked up (contract or recorder not configured). */
  reason?: string;
}

export interface DeliveredItem {
  title: string;
  body: string;
  /** Unix seconds. */
  deliveredAt: number;
}

/** POST /api/vendor/buy { payload | signed, flowId, paymentRequestId } (200, or 402 when not paid yet) */
export type VendorBuyResponse = { ok: true; item: DeliveredItem } | { ok: false; reasons: string[] };
