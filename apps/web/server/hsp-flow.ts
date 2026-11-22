/**
 * The HSP Agentic Payment steps the routes run (PROTOCOL §2), with error mapping:
 * unreachable or refused → HspUnavailableError (503), expired quote → 409 quote_expired,
 * any other tool error or unreadable result → 502 hsp_error.
 */
import {
  findField,
  isQuoteExpiredError,
  parseChainConfig,
  parseCreateOrderResult,
  parseFinalizeResult,
  parsePrepareResult,
  parseQueryResult,
  pickPaymentOption,
  unwrapToolResult,
  type CartMandate,
  type HspOrder,
  type HspPaymentOption,
  type HspPaymentProtocol,
  type HspPaymentStatus,
  type HspPrepared,
  type PaymentPreference,
} from '@nod/protocol';
import type { Address } from 'viem';
import type { ApiContext } from './context.js';
import { HSP_ALLOWLIST_HINT, HspUnavailableError, REFUSAL_TEXT, isHspUnavailable, type HspCallOptions } from './hsp.js';
import { HttpError, errorMessage } from './http.js';
import type { HspOpaque } from './types.js';

export const CHAIN_CONFIG_TTL_MS = 5 * 60_000;
/** How long /api/config reuses a failed probe instead of waiting on HSP again. */
const FAILED_PROBE_TTL_MS = 15_000;

const preview = (value: unknown): string => {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
};

const isToolError = (raw: unknown): boolean =>
  typeof raw === 'object' && raw !== null && (raw as { isError?: unknown }).isError === true;

/** Map anything thrown by an HSP call or result parser to the API's error model. */
export function mapHspError(error: unknown, tool: string): Error {
  if (error instanceof HttpError || isHspUnavailable(error)) return error as Error;
  const message = errorMessage(error);
  if (isQuoteExpiredError(error)) {
    return new HttpError(409, `The HSP quote expired: prepare the payment again and sign the new authorization (${message})`, 'quote_expired');
  }
  if (REFUSAL_TEXT.test(message)) return new HspUnavailableError(`HSP refused ${tool}: ${message}. ${HSP_ALLOWLIST_HINT}`, { cause: error });
  return new HttpError(502, message.startsWith(tool) ? `HSP ${message}` : `HSP ${tool} failed: ${message}`, 'hsp_error');
}

/** Call one tool, logging its duration; errors come back mapped. */
export async function hspCall(ctx: ApiContext, tool: string, args: Record<string, unknown>, options?: HspCallOptions): Promise<unknown> {
  const started = Date.now();
  try {
    const raw = await ctx.hsp.callTool(tool, args, options);
    ctx.log.info(`hsp ${tool}: ${Date.now() - started} ms${isToolError(raw) ? ' (tool error)' : ''}`);
    return raw;
  } catch (error) {
    ctx.log.warn(`hsp ${tool} failed after ${Date.now() - started} ms: ${errorMessage(error)}`);
    throw mapHspError(error, tool);
  }
}

function parseStep<T>(tool: string, parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    throw mapHspError(error, tool);
  }
}

// ---------------------------------------------------------------------------
// get_chain_config (cached)
// ---------------------------------------------------------------------------

interface ConfigCacheEntry {
  at: number;
  options?: HspPaymentOption[];
  error?: unknown;
  inflight?: Promise<HspPaymentOption[]>;
}

const configCache = new WeakMap<object, ConfigCacheEntry>();

/**
 * Payment options from get_chain_config, cached for 5 minutes per HSP client. Concurrent
 * callers share one call. `reuseFailure` (for /api/config) rethrows a failure from the last
 * 15 s instead of waiting on HSP again.
 */
export async function paymentOptions(ctx: ApiContext, opts: { timeoutMs?: number; reuseFailure?: boolean } = {}): Promise<HspPaymentOption[]> {
  const entry = configCache.get(ctx.hsp);
  const now = Date.now();
  if (entry?.options && now - entry.at < CHAIN_CONFIG_TTL_MS) return entry.options;
  if (entry?.inflight) return entry.inflight;
  if (opts.reuseFailure && entry?.error !== undefined && now - entry.at < FAILED_PROBE_TTL_MS) throw entry.error;

  const inflight = (async () => {
    const raw = await hspCall(ctx, 'get_chain_config', {}, opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : undefined);
    const options = parseStep('get_chain_config', () => parseChainConfig(raw));
    if (options.length === 0) {
      throw new HttpError(502, `HSP get_chain_config offered no payment option Nod can read: ${preview(raw)}`, 'hsp_error');
    }
    return options;
  })();
  configCache.set(ctx.hsp, { at: entry?.at ?? 0, inflight });
  try {
    const options = await inflight;
    configCache.set(ctx.hsp, { at: Date.now(), options });
    return options;
  } catch (error) {
    configCache.set(ctx.hsp, { at: Date.now(), error });
    throw error;
  }
}

/** The cached options without calling HSP (empty when there are none yet). */
export function cachedPaymentOptions(ctx: ApiContext): HspPaymentOption[] {
  return configCache.get(ctx.hsp)?.options ?? [];
}

/** pickPaymentOption with the configured preferences; 502 no_payment_option when nothing matches. */
export function pickOption(options: HspPaymentOption[], prefer: PaymentPreference): HspPaymentOption {
  try {
    return pickPaymentOption(options, prefer);
  } catch (error) {
    throw new HttpError(502, `${errorMessage(error)} (check NOD_PAY_NETWORK, NOD_PAY_CHAIN_ID and NOD_PAY_COIN)`, 'no_payment_option');
  }
}

const normKey = (key: string): string => key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const KNOWN_NETWORKS: Record<string, number> = {
  sepolia: 11155111,
  ethereumsepolia: 11155111,
  ethsepolia: 11155111,
  hsk: 177,
  hashkey: 177,
  hskchain: 177,
  hashkeychain: 177,
  hskmainnet: 177,
  hashkeymainnet: 177,
  hashkeychainmainnet: 177,
  hsktestnet: 133,
  hashkeytestnet: 133,
  hskchaintestnet: 133,
  hashkeychaintestnet: 133,
};

/** Chain id of an HSP network name: from get_chain_config, else eip155:N, a bare number or a known name. */
export function chainIdForNetwork(network: string | undefined, options: readonly HspPaymentOption[]): number | undefined {
  if (!network || network.trim() === '') return undefined;
  const name = network.trim();
  const fromConfig = options.find((o) => o.network.toLowerCase() === name.toLowerCase());
  if (fromConfig) return fromConfig.chainId;
  const caip2 = /^eip155:([0-9]+)$/i.exec(name);
  if (caip2) return Number(caip2[1]);
  if (/^[0-9]+$/.test(name)) return Number(name);
  return KNOWN_NETWORKS[normKey(name)];
}

/**
 * The option a settled payment used: the same picking rule as /api/pay/start, restricted to
 * the network HSP reports for the payment.
 */
export function optionForNetwork(options: HspPaymentOption[], network: string | undefined, prefer: PaymentPreference): HspPaymentOption {
  const chainId = chainIdForNetwork(network, options);
  if (network) {
    const onNetwork = options.filter(
      (o) => o.network.toLowerCase() === network.trim().toLowerCase() || (chainId !== undefined && o.chainId === chainId),
    );
    if (onNetwork.length > 0) {
      try {
        return pickPaymentOption(onNetwork, prefer.coin ? { coin: prefer.coin } : {});
      } catch {
        return pickPaymentOption(onNetwork);
      }
    }
  }
  return pickOption(options, prefer);
}

// ---------------------------------------------------------------------------
// Order, prepare, finalize, submit, query
// ---------------------------------------------------------------------------

export async function createOrder(ctx: ApiContext, input: { merchantName: string; payTo: Address; cart: CartMandate }): Promise<HspOrder> {
  const raw = await hspCall(ctx, 'create_order', { merchant_name: input.merchantName, pay_to: input.payTo, cart_mandate: input.cart });
  return parseStep('create_order', () => parseCreateOrderResult(raw, input.cart));
}

export async function preparePayment(
  ctx: ApiContext,
  input: { flowId: string; payer: Address; protocol: HspPaymentProtocol },
): Promise<HspPrepared> {
  const raw = await hspCall(ctx, 'prepare_payment', { flow_id: input.flowId, payer: input.payer, protocol: input.protocol });
  return parseStep('prepare_payment', () => parsePrepareResult(raw));
}

/** finalize_payment; returns payment_mandate_json for submit_payment. */
export async function finalizePayment(ctx: ApiContext, input: { flowId: string; signature: string; opaque: HspOpaque }): Promise<unknown> {
  const raw = await hspCall(ctx, 'finalize_payment', {
    // flow_id is not in the documented signature; the live schema decides whether it is sent.
    flow_id: input.flowId,
    signature: input.signature,
    payment_payload: input.opaque.payment_payload,
    payment_mandate_contents: input.opaque.payment_mandate_contents,
    cart_hash: input.opaque.cart_hash,
  });
  return parseStep('finalize_payment', () => parseFinalizeResult(raw)).paymentMandateJson;
}

/** submit_payment; returns the status HSP reports (payment-submitted when it does not say). */
export async function submitPayment(ctx: ApiContext, input: { flowId: string; paymentMandateJson: unknown }): Promise<string> {
  const raw = await hspCall(ctx, 'submit_payment', { flow_id: input.flowId, payment_mandate_json: input.paymentMandateJson });
  const data = parseStep('submit_payment', () => unwrapToolResult<unknown>(raw, 'submit_payment'));
  const status = findField(data, ['payment_status', 'status', 'state']);
  return typeof status === 'string' && status.trim() !== '' ? status.trim() : 'payment-submitted';
}

export async function queryPayment(
  ctx: ApiContext,
  input: { flowId?: string; paymentRequestId?: string; merchantName: string },
): Promise<HspPaymentStatus> {
  const raw = await hspCall(ctx, 'query_payment', {
    flow_id: input.flowId,
    payment_request_id: input.paymentRequestId,
    expected_merchant_name: input.merchantName,
  });
  return parseStep('query_payment', () => parseQueryResult(raw));
}
