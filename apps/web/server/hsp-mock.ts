/**
 * MOCK HSP: development only (HSP_MODE=mock). Nothing here talks to HSP or to any chain.
 *
 * Simulates the HSP Agentic Payment tools in memory so the app can be built and demoed without
 * an allowlisted IP:
 *   get_chain_config  one option: Circle test USDC on Ethereum Sepolia, EIP-3009
 *   create_order      checks the cart mandate, returns a flow id
 *   prepare_payment   a real EIP-3009 TransferWithAuthorization typed-data payload for that token
 *   finalize_payment  verifies the payer's signature over that payload (a wrong signature fails)
 *   submit_payment    starts the status timeline
 *   query_payment     payment-submitted → processing → included → safe over about 10 s,
 *                     with a FAKE settlement tx hash (nothing is broadcast)
 *   get_order, estimate_fee
 *                     documented HSP tools that Nod does not call; the live tool list is logged
 *                     by LiveHspClient on connect, compare against it
 * Results use a `{ code, msg, data }` envelope in MCP text content, which exercises the same
 * lenient parsers as live results. The API skips the on-chain settlement check and the receipt
 * anchor in mock mode and says so (`skipped: { reason: 'mock mode' }`).
 */
import { SEPOLIA_TEST_USDC, X402_METHOD, sepolia, usdToRaw } from '@nod/protocol';
import {
  bytesToHex,
  getAddress,
  isAddress,
  keccak256,
  recoverTypedDataAddress,
  stringToHex,
  type Address,
  type Hash,
  type Hex,
} from 'viem';
import type { HspCallOptions, HspClient, HspToolInfo } from './hsp.js';

export const MOCK_NETWORK = 'sepolia';
export const MOCK_CHAIN_ID = sepolia.id;
export const MOCK_TOKEN: Address = SEPOLIA_TEST_USDC;
export const MOCK_COIN = 'USDC';
export const MOCK_DECIMALS = 6;
export const MOCK_QUOTE_TTL_SEC = 300;

/** Seconds after submit_payment at which each status starts. */
export const MOCK_TIMELINE: ReadonlyArray<readonly [number, string]> = [
  [0, 'payment-submitted'],
  [3, 'payment-processing'],
  [6, 'payment-included'],
  [10, 'payment-safe'],
];

/** Mock flows are forgotten after this long. */
const FLOW_TTL_MS = 2 * 60 * 60 * 1000;

interface MockFlow {
  flowId: string;
  paymentRequestId: string;
  merchantName: string;
  payTo: Address;
  amountUsd: string;
  cartHash: Hex;
  createdAt: number;
  cancelled?: boolean;
  prepared?: {
    payer: Address;
    eip712: MockTypedData;
    valueRaw: string;
    quoteExpiresAt: number;
  };
  finalized?: boolean;
  submittedAt?: number;
  txHash?: Hash;
}

interface MockTypedData {
  domain: { name: string; version: string; chainId: number; verifyingContract: Address };
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: 'TransferWithAuthorization';
  message: { from: Address; to: Address; value: string; validAfter: string; validBefore: string; nonce: Hex };
}

export interface MockStore {
  flows: Map<string, MockFlow>;
}

const STORE_KEY = Symbol.for('nod.mockHsp.store');

/** Process-wide store, so flows survive dev-server module reloads. */
export function sharedMockStore(): MockStore {
  const holder = globalThis as unknown as Record<symbol, MockStore | undefined>;
  return (holder[STORE_KEY] ??= { flows: new Map() });
}

export const newMockStore = (): MockStore => ({ flows: new Map() });

const str = { type: 'string' } as const;

export const MOCK_TOOLS: HspToolInfo[] = [
  {
    name: 'get_chain_config',
    description: 'MOCK: networks and tokens HSP can settle (one: Sepolia test USDC, eip3009)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_order',
    description: 'MOCK: create a payment flow from a cart mandate',
    inputSchema: {
      type: 'object',
      properties: { merchant_name: str, pay_to: str, cart_mandate: { type: 'object' } },
      required: ['merchant_name', 'pay_to', 'cart_mandate'],
    },
  },
  {
    name: 'prepare_payment',
    description: 'MOCK: EIP-712 authorization for the payer to sign',
    inputSchema: {
      type: 'object',
      properties: { flow_id: str, payer: str, protocol: { type: 'string', enum: ['eip3009', 'permit2'] } },
      required: ['flow_id', 'payer'],
    },
  },
  {
    name: 'finalize_payment',
    description: "MOCK: check the payer's signature and build the payment mandate",
    inputSchema: {
      type: 'object',
      properties: { signature: str, payment_payload: { type: 'object' }, payment_mandate_contents: { type: 'object' }, cart_hash: str },
      required: ['signature', 'payment_payload', 'payment_mandate_contents', 'cart_hash'],
    },
  },
  {
    name: 'submit_payment',
    description: 'MOCK: submit the payment mandate (nothing is broadcast)',
    inputSchema: { type: 'object', properties: { payment_mandate_json: str }, required: ['payment_mandate_json'] },
  },
  {
    name: 'query_payment',
    description: 'MOCK: payment status, advancing submitted → processing → included → safe over ~10 s',
    inputSchema: { type: 'object', properties: { flow_id: str, payment_request_id: str, expected_merchant_name: str } },
  },
  {
    name: 'get_order',
    description: 'MOCK: order summary for a flow (Nod does not call it)',
    inputSchema: { type: 'object', properties: { flow_id: str }, required: ['flow_id'] },
  },
  {
    name: 'estimate_fee',
    description: 'MOCK: network fee estimate for a flow (Nod does not call it)',
    inputSchema: { type: 'object', properties: { flow_id: str }, required: ['flow_id'] },
  },
];

const EIP712_DOMAIN_TYPE = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
];

const TRANSFER_WITH_AUTHORIZATION_TYPE = [
  { name: 'from', type: 'address' },
  { name: 'to', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'validAfter', type: 'uint256' },
  { name: 'validBefore', type: 'uint256' },
  { name: 'nonce', type: 'bytes32' },
];

class MockToolError extends Error {
  constructor(
    readonly hspCode: number,
    message: string,
  ) {
    super(message);
  }
}

const result = (data: unknown) => ({ content: [{ type: 'text', text: JSON.stringify({ code: 0, msg: 'success', data }) }] });

const errorResult = (code: number, msg: string) => ({
  isError: true,
  content: [{ type: 'text', text: JSON.stringify({ code, msg: `${msg} (mock HSP)` }) }],
});

const randomHex = (bytes: number): string => bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(bytes))).slice(2);

const rfc3339 = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

const asRecord = (value: unknown, name: string): Record<string, unknown> => {
  let v = value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      throw new MockToolError(40001, `${name} is not JSON`);
    }
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new MockToolError(40001, `${name} must be an object`);
  return v as Record<string, unknown>;
};

const needString = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.trim() === '') throw new MockToolError(40001, `${name} is required`);
  return value.trim();
};

const needAddress = (value: unknown, name: string): Address => {
  if (typeof value !== 'string' || !isAddress(value, { strict: false })) throw new MockToolError(40001, `${name} must be an address`);
  return getAddress(value);
};

const path = (root: unknown, keys: string[]): unknown => {
  let node = root;
  for (const key of keys) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = Array.isArray(node) ? node[Number(key)] : (node as Record<string, unknown>)[key];
  }
  return node;
};

export interface MockHspOptions {
  /** Clock in milliseconds (tests advance it). */
  now?: () => number;
  /** Flow store; defaults to the process-wide store. */
  store?: MockStore;
}

export class MockHspClient implements HspClient {
  readonly mode = 'mock' as const;
  private readonly now: () => number;
  private readonly store: MockStore;

  constructor(options: MockHspOptions = {}) {
    this.now = options.now ?? Date.now;
    this.store = options.store ?? sharedMockStore();
  }

  async listTools(): Promise<HspToolInfo[]> {
    return MOCK_TOOLS;
  }

  async callTool(name: string, args: Record<string, unknown>, _options?: HspCallOptions): Promise<unknown> {
    try {
      switch (name) {
        case 'get_chain_config':
          return result(this.chainConfig());
        case 'create_order':
          return result(this.createOrder(args));
        case 'prepare_payment':
          return result(this.prepare(args));
        case 'finalize_payment':
          return result(await this.finalize(args));
        case 'submit_payment':
          return result(this.submit(args));
        case 'query_payment':
          return result(this.query(args));
        case 'get_order':
          return result(this.getOrder(args));
        case 'estimate_fee':
          return result(this.estimateFee(args));
        default:
          throw new MockToolError(40400, `Unknown tool ${name}`);
      }
    } catch (error) {
      if (error instanceof MockToolError) return errorResult(error.hspCode, error.message);
      throw error;
    }
  }

  private chainConfig() {
    return {
      networks: [
        {
          network: MOCK_NETWORK,
          chain_id: MOCK_CHAIN_ID,
          display_name: 'Ethereum Sepolia (mock HSP)',
          tokens: [{ coin: MOCK_COIN, contract_address: MOCK_TOKEN, decimals: MOCK_DECIMALS, payment_protocol: 'eip3009' }],
        },
      ],
    };
  }

  private flow(args: Record<string, unknown>): MockFlow {
    const flowId = typeof args.flow_id === 'string' ? args.flow_id : undefined;
    const requestId = typeof args.payment_request_id === 'string' ? args.payment_request_id : undefined;
    let flow = flowId ? this.store.flows.get(flowId) : undefined;
    if (!flow && requestId) flow = [...this.store.flows.values()].find((f) => f.paymentRequestId === requestId);
    if (!flow) {
      if (!flowId && !requestId) throw new MockToolError(40001, 'flow_id or payment_request_id is required');
      throw new MockToolError(40400, `No payment flow ${flowId ?? requestId}`);
    }
    return flow;
  }

  private createOrder(args: Record<string, unknown>) {
    const merchantName = needString(args.merchant_name, 'merchant_name');
    const payTo = needAddress(args.pay_to, 'pay_to');
    const cart = asRecord(args.cart_mandate, 'cart_mandate');
    const method = path(cart, ['contents', 'payment_request', 'method_data', '0', 'data']);
    const details = path(cart, ['contents', 'payment_request', 'details']);
    const value = path(details, ['total', 'amount', 'value']);
    const cartExpiry = path(cart, ['contents', 'cart_expiry']);
    if (typeof method !== 'object' || method === null) throw new MockToolError(40001, 'cart_mandate has no x402 method data');
    const m = method as Record<string, unknown>;
    if (m.network !== MOCK_NETWORK || Number(m.chain_id) !== MOCK_CHAIN_ID) {
      throw new MockToolError(40002, `network ${String(m.network)} (${String(m.chain_id)}) is not offered`);
    }
    if (typeof m.contract_address !== 'string' || m.contract_address.toLowerCase() !== MOCK_TOKEN.toLowerCase()) {
      throw new MockToolError(40002, `token ${String(m.contract_address)} is not offered`);
    }
    if (typeof m.pay_to !== 'string' || m.pay_to.toLowerCase() !== payTo.toLowerCase()) {
      throw new MockToolError(40001, 'pay_to does not match the cart mandate');
    }
    if (path(cart, ['contents', 'merchant_name']) !== merchantName) {
      throw new MockToolError(40001, 'merchant_name does not match the cart mandate');
    }
    if (typeof value !== 'string' || !/^\d+(\.\d{1,2})?$/.test(value) || Number(value) <= 0) {
      throw new MockToolError(40001, 'cart total must be a positive USD amount');
    }
    if (typeof cartExpiry !== 'string' || !(Date.parse(cartExpiry) > this.now())) {
      throw new MockToolError(40003, 'cart_expiry must be in the future');
    }
    const paymentRequestId = needString(path(details, ['id']), 'payment_request.details.id');

    const now = this.now();
    for (const [id, old] of this.store.flows) if (now - old.createdAt > FLOW_TTL_MS) this.store.flows.delete(id);
    const flow: MockFlow = {
      flowId: `mockflow_${randomHex(12)}`,
      paymentRequestId,
      merchantName,
      payTo,
      amountUsd: value,
      cartHash: keccak256(stringToHex(JSON.stringify(cart))),
      createdAt: now,
    };
    this.store.flows.set(flow.flowId, flow);
    return { flow_id: flow.flowId, payment_request_id: paymentRequestId, status: 'order-created' };
  }

  private prepare(args: Record<string, unknown>) {
    const flow = this.flow(args);
    if (flow.cancelled) throw new MockToolError(40900, 'order was cancelled');
    if (flow.submittedAt !== undefined) throw new MockToolError(40900, 'payment was already submitted');
    const payer = needAddress(args.payer, 'payer');
    const protocol = args.protocol === undefined ? 'eip3009' : String(args.protocol);
    if (protocol !== 'eip3009') throw new MockToolError(40002, `protocol ${protocol} is not simulated; only eip3009`);

    const nowMs = this.now();
    const quoteExpiresAt = Math.floor(nowMs / 1000) + MOCK_QUOTE_TTL_SEC;
    const valueRaw = usdToRaw(flow.amountUsd, MOCK_DECIMALS).toString();
    const eip712: MockTypedData = {
      domain: { name: 'USDC', version: '2', chainId: MOCK_CHAIN_ID, verifyingContract: MOCK_TOKEN },
      types: { EIP712Domain: EIP712_DOMAIN_TYPE, TransferWithAuthorization: TRANSFER_WITH_AUTHORIZATION_TYPE },
      primaryType: 'TransferWithAuthorization',
      message: {
        from: payer,
        to: flow.payTo,
        value: valueRaw,
        validAfter: '0',
        validBefore: String(quoteExpiresAt),
        nonce: `0x${randomHex(32)}`,
      },
    };
    flow.prepared = { payer, eip712, valueRaw, quoteExpiresAt };
    flow.finalized = false;
    return {
      flow_id: flow.flowId,
      payment_request_id: flow.paymentRequestId,
      protocol,
      eip712,
      token_total_raw: valueRaw,
      quote_expires_at: rfc3339(quoteExpiresAt * 1000),
      payment_payload: {
        x402Version: 2,
        scheme: 'exact',
        network: MOCK_NETWORK,
        payload: { authorization: eip712.message },
        extra: { flow_id: flow.flowId },
      },
      payment_mandate_contents: {
        payment_mandate_id: `pm_${randomHex(8)}`,
        flow_id: flow.flowId,
        payment_details_id: flow.paymentRequestId,
        payment_details_total: { label: 'Total', amount: { currency: 'USD', value: flow.amountUsd } },
        payment_response: { method_name: X402_METHOD, details: { network: MOCK_NETWORK, token: MOCK_TOKEN } },
        merchant_agent: flow.merchantName,
        timestamp: rfc3339(nowMs),
      },
      cart_hash: flow.cartHash,
    };
  }

  private async finalize(args: Record<string, unknown>) {
    const payload = asRecord(args.payment_payload, 'payment_payload');
    const contents = asRecord(args.payment_mandate_contents, 'payment_mandate_contents');
    const flowId = path(payload, ['extra', 'flow_id']) ?? contents.flow_id;
    const flow = this.flow({ flow_id: flowId });
    const prepared = flow.prepared;
    if (!prepared) throw new MockToolError(40900, 'prepare_payment was not called for this flow');
    if (args.cart_hash !== flow.cartHash) throw new MockToolError(40001, 'cart_hash does not match the order');
    if (Math.floor(this.now() / 1000) >= prepared.quoteExpiresAt) {
      throw new MockToolError(30043, 'Quote expired; call prepare_payment again and sign the new authorization');
    }
    const signature = needString(args.signature, 'signature');
    if (!/^0x([0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/.test(signature)) throw new MockToolError(40001, 'signature must be 64 or 65 bytes of hex');
    const { EIP712Domain: _domainType, ...types } = prepared.eip712.types;
    let signer: Address;
    try {
      signer = await recoverTypedDataAddress({
        domain: prepared.eip712.domain,
        types,
        primaryType: prepared.eip712.primaryType,
        message: prepared.eip712.message,
        signature: signature as Hex,
      });
    } catch {
      throw new MockToolError(40001, 'signature could not be recovered');
    }
    if (signer.toLowerCase() !== prepared.payer.toLowerCase()) {
      throw new MockToolError(40101, `signature is by ${signer}, not by the payer ${prepared.payer}`);
    }
    flow.finalized = true;
    return {
      payment_mandate_json: JSON.stringify({
        payment_mandate_contents: contents,
        user_authorization: `mock.${signature.slice(2, 26)}`,
        flow_id: flow.flowId,
      }),
    };
  }

  private submit(args: Record<string, unknown>) {
    const mandate = asRecord(args.payment_mandate_json, 'payment_mandate_json');
    const flow = this.flow({ flow_id: mandate.flow_id });
    if (!flow.finalized) throw new MockToolError(40900, 'finalize_payment was not called for this flow');
    if (flow.submittedAt === undefined) {
      flow.submittedAt = this.now();
      flow.txHash = keccak256(stringToHex(`nod-mock-settlement:${flow.flowId}`));
    }
    return { flow_id: flow.flowId, payment_request_id: flow.paymentRequestId, status: this.statusOf(flow).status };
  }

  private statusOf(flow: MockFlow): { status: string; reason?: string } {
    if (flow.cancelled) return { status: 'payment-failed', reason: 'order cancelled' };
    if (flow.submittedAt === undefined) return { status: 'payment-pending' };
    const elapsed = (this.now() - flow.submittedAt) / 1000;
    let status = MOCK_TIMELINE[0]![1];
    for (const [at, name] of MOCK_TIMELINE) if (elapsed >= at) status = name;
    return { status };
  }

  private query(args: Record<string, unknown>) {
    const flow = this.flow(args);
    const { status, reason } = this.statusOf(flow);
    const broadcast = status !== 'payment-pending' && status !== 'payment-submitted' && !flow.cancelled;
    const expected = typeof args.expected_merchant_name === 'string' ? args.expected_merchant_name : undefined;
    return {
      flow_id: flow.flowId,
      payment_request_id: flow.paymentRequestId,
      ...(expected !== undefined ? { attribution_verified: expected === flow.merchantName } : {}),
      payment: {
        status,
        network: MOCK_NETWORK,
        coin: MOCK_COIN,
        amount: flow.prepared?.valueRaw ?? usdToRaw(flow.amountUsd, MOCK_DECIMALS).toString(),
        to_pay_address: flow.payTo,
        payer_address: flow.prepared?.payer ?? null,
        tx_signature: broadcast ? flow.txHash : null,
        status_reason: reason ?? null,
      },
    };
  }

  private getOrder(args: Record<string, unknown>) {
    const flow = this.flow(args);
    const state = flow.submittedAt !== undefined ? 'submitted' : flow.prepared ? 'prepared' : 'created';
    return {
      flow_id: flow.flowId,
      payment_request_id: flow.paymentRequestId,
      merchant_name: flow.merchantName,
      pay_to: flow.payTo,
      amount_usd: flow.amountUsd,
      status: state,
    };
  }

  private estimateFee(args: Record<string, unknown>) {
    const flow = this.flow(args);
    // The mock Gateway advances the network fee, so the payer pays only the order total.
    return { flow_id: flow.flowId, gas_fee_advanced: true, gas_fee: '0.00', currency: 'USD' };
  }
}

export const createMockHsp = (options: MockHspOptions = {}): MockHspClient => new MockHspClient(options);
