import { randomUUID } from 'node:crypto';
import {
  SEPOLIA_TEST_USDC,
  TRANSFER_TOPIC,
  createTerms,
  decodeLink,
  encodeLink,
  hashTerms,
  newTermsId,
  termsTypedData,
  verifyTerms,
  type NodTerms,
  type SettlementReceipt,
  type SignedTerms,
} from '@nod/protocol';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { encodeAbiParameters, getAddress, keccak256, pad, stringToHex, type Address, type Hash, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApi, type ApiDeps } from './api.js';
import type { AnchorRequest, ChainAccess, ChainReader } from './chain.js';
import { silentLogger } from './context.js';
import { HspUnavailableError, LiveHspClient, shapeArgs, type HspClient } from './hsp.js';
import { MOCK_TIMELINE, createMockHsp, newMockStore } from './hsp-mock.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const keyOf = (label: string): Hex => keccak256(stringToHex(`nod-server-test-${label}`));
const AGENT_KEY = keyOf('agent');
const AGENT = privateKeyToAccount(AGENT_KEY).address;
const RECORDER_KEY = keyOf('recorder');
const RECORDER = privateKeyToAccount(RECORDER_KEY).address;
const PAYER_ACCOUNT = privateKeyToAccount(keyOf('payer'));
const PAYER = PAYER_ACCOUNT.address;
const VENDOR = privateKeyToAccount(keyOf('vendor')).address;
const OTHER = privateKeyToAccount(keyOf('other')).address;
const RECEIPTS: Address = getAddress('0x5555555555555555555555555555555555555555');
const TX: Hash = `0x${'ab'.repeat(32)}`;
const ANCHOR_TX: Hash = `0x${'cd'.repeat(32)}`;
const ORIGIN = 'http://localhost:5173';

const LIVE_ENV = {
  HSP_MODE: 'live',
  NOD_MERCHANT_NAME: 'Team Nod',
  NOD_DEMO_AGENT_KEY: AGENT_KEY,
  NOD_DEMO_VENDOR: VENDOR,
  NOD_RECEIPTS_ADDRESS: RECEIPTS,
  NOD_RECORDER_KEY: RECORDER_KEY,
};

type Body = Record<string, any>;

const get = (path: string, headers: Record<string, string> = {}) => new Request(`${ORIGIN}${path}`, { headers });
const post = (path: string, body: unknown) =>
  new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

async function send(api: (r: Request) => Promise<Response>, request: Request): Promise<{ status: number; body: Body; res: Response }> {
  const res = await api(request);
  return { status: res.status, body: (await res.json()) as Body, res };
}

/** MCP tool result with JSON text content, as HSP returns it. */
const text = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const toolError = (message: string) => ({ isError: true, content: [{ type: 'text', text: message }] });

const demoTerms = (overrides: Partial<{ payTo: string; amountUsd: string; expiresInSec: number }> = {}): Promise<SignedTerms> =>
  createTerms(
    { merchant: 'Nod weather agent', payTo: VENDOR, amountUsd: '0.10', purpose: '1 live weather report', expiresInSec: 900, ...overrides },
    AGENT_KEY,
  );

async function expiredTerms(): Promise<SignedTerms> {
  const account = privateKeyToAccount(AGENT_KEY);
  const terms: NodTerms = {
    v: 2,
    id: newTermsId(),
    merchant: 'Nod weather agent',
    payTo: VENDOR,
    amountUsd: '0.10',
    purpose: '1 live weather report',
    expiry: Math.floor(Date.now() / 1000) - 60,
    agent: account.address,
  };
  return { terms, sig: await account.signTypedData(termsTypedData(terms)) };
}

const CHAIN_CONFIG = {
  networks: [
    {
      network: 'sepolia',
      chain_id: 11155111,
      tokens: [{ coin: 'USDC', contract_address: SEPOLIA_TEST_USDC, decimals: 6, payment_protocol: 'eip3009' }],
    },
  ],
};

const eip712For = (payer: string, payTo: string = VENDOR) => ({
  domain: { name: 'USDC', version: '2', chainId: 11155111, verifyingContract: SEPOLIA_TEST_USDC },
  types: {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  },
  primaryType: 'TransferWithAuthorization',
  message: { from: payer, to: payTo, value: '100000', validAfter: '0', validBefore: '1893456300', nonce: `0x${'12'.repeat(32)}` },
});

type ToolHandler = (args: Record<string, any>) => unknown;

/** A scripted HSP: each tool returns what its handler returns (or throws). */
function fakeHsp(overrides: Record<string, ToolHandler> = {}, mode: 'live' | 'mock' = 'live') {
  const calls: Array<{ name: string; args: Record<string, any> }> = [];
  const handlers: Record<string, ToolHandler> = {
    get_chain_config: () => text(CHAIN_CONFIG),
    create_order: (args) => text({ flow_id: 'flow-1', payment_request_id: args.cart_mandate.contents.payment_request.details.id }),
    prepare_payment: (args) =>
      text({
        eip712: eip712For(args.payer),
        token_total_raw: '100000',
        quote_expires_at: '2030-01-01T00:05:00Z',
        payment_payload: { opaque: 'payload' },
        payment_mandate_contents: { payment_mandate_id: 'pm-1' },
        cart_hash: '0xcafe',
      }),
    finalize_payment: () => text({ payment_mandate_json: '{"mandate":1}' }),
    submit_payment: () => text({ status: 'payment-submitted' }),
    query_payment: () =>
      text({
        payment: { status: 'payment-safe', tx_signature: TX, network: 'sepolia', payer_address: PAYER, to_pay_address: VENDOR },
        attribution_verified: true,
      }),
    ...overrides,
  };
  const client: HspClient = {
    mode,
    async callTool(name, args) {
      calls.push({ name, args });
      const handler = handlers[name];
      if (!handler) throw new Error(`unexpected HSP tool ${name}`);
      return handler(args);
    },
  };
  return { client, calls, names: () => calls.map((c) => c.name) };
}

const transferLog = (token: Address, from: Address, to: Address, value: bigint) => ({
  address: token,
  topics: [TRANSFER_TOPIC, pad(from), pad(to)] as Hex[],
  data: encodeAbiParameters([{ type: 'uint256' }], [value]),
});

const EMPTY_RECEIPT = {
  settlementTx: `0x${'00'.repeat(32)}`,
  chainId: 0n,
  payer: '0x0000000000000000000000000000000000000000',
  payTo: '0x0000000000000000000000000000000000000000',
  amount: 0n,
  anchoredAt: 0n,
};

interface StoredReceipt {
  settlementTx: Hex;
  chainId: bigint;
  payer: Address;
  payTo: Address;
  amount: bigint;
  anchoredAt: bigint;
}

/** Chains backed by maps: settlement receipts by tx hash, NodReceipts by `${recorder}:${termsHash}`. */
function fakeChains(txReceipts: Record<string, SettlementReceipt> = {}) {
  const anchored = new Map<string, StoredReceipt>();
  const anchors: AnchorRequest[] = [];
  let failReads = false;
  const readContract = (async ({ functionName, args }: { functionName: string; args: readonly unknown[] }) => {
    if (failReads) throw new Error('rpc down');
    const key = `${String(args[0]).toLowerCase()}:${String(args[1]).toLowerCase()}`;
    if (functionName === 'receiptOf') return anchored.get(key) ?? EMPTY_RECEIPT;
    if (functionName === 'isAnchored') return anchored.has(key);
    throw new Error(`unexpected read ${functionName}`);
  }) as unknown as ChainReader['readContract'];
  const reader: ChainReader = {
    async getTransactionReceipt({ hash }) {
      const receipt = txReceipts[hash];
      if (!receipt) throw new Error(`receipt ${hash} not found`);
      return receipt;
    },
    readContract,
    async waitForTransactionReceipt() {
      return { status: 'success' };
    },
  };
  const access: ChainAccess = {
    reader: vi.fn(() => reader),
    async anchor(request) {
      anchors.push(request);
      const recorder = privateKeyToAccount(request.privateKey).address;
      anchored.set(`${recorder.toLowerCase()}:${request.args.termsHash.toLowerCase()}`, {
        settlementTx: request.args.settlementTx,
        chainId: BigInt(request.args.chainId),
        payer: request.args.payer,
        payTo: request.args.payTo,
        amount: request.args.amount,
        anchoredAt: 1_900_000_000n,
      });
      return ANCHOR_TX;
    },
  };
  return {
    access,
    anchors,
    anchored,
    failReads: () => {
      failReads = true;
    },
    store: (recorder: Address, termsHash: Hex, receipt: StoredReceipt) =>
      anchored.set(`${recorder.toLowerCase()}:${termsHash.toLowerCase()}`, receipt),
  };
}

const paidReceipt = (value = 100_000n): SettlementReceipt => ({
  status: 'success',
  logs: [transferLog(SEPOLIA_TEST_USDC, PAYER, VENDOR, value)],
});

function apiWith(deps: Partial<ApiDeps> & { env?: Record<string, string> } = {}) {
  return createApi({ log: silentLogger, chains: fakeChains().access, ...deps, env: deps.env ?? LIVE_ENV });
}

const offlineFetch = (async () => {
  throw new Error('offline');
}) as unknown as typeof fetch;

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

describe('dispatcher', () => {
  it('answers JSON 404 for unknown routes, 405 for wrong methods and 204 for CORS preflight', async () => {
    const api = apiWith({ hsp: fakeHsp().client });
    const missing = await send(api, get('/api/nope'));
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('not_found');
    const wrong = await send(api, get('/api/pay/start'));
    expect(wrong.status).toBe(405);
    expect(wrong.res.headers.get('allow')).toBe('POST');
    const preflight = await api(new Request(`${ORIGIN}/api/pay/start`, { method: 'OPTIONS', headers: { origin: 'https://nod.example' } }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('reports invalid configuration as 500 config_error', async () => {
    const api = apiWith({ hsp: fakeHsp().client, env: { ...LIVE_ENV, NOD_RECEIPTS_ADDRESS: 'nope', NOD_DEMO_USD: '0.001' } });
    const res = await send(api, get('/api/config'));
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('config_error');
    expect(res.body.error).toMatch(/NOD_RECEIPTS_ADDRESS/);
    expect(res.body.error).toMatch(/NOD_DEMO_USD/);
  });

  it('rejects a bad EIP-55 checksum in configured addresses', async () => {
    const badChecksum = VENDOR.slice(0, 2) + VENDOR.slice(2).replace(/[a-f]/, (c) => c.toUpperCase());
    const api = apiWith({ hsp: fakeHsp().client, env: { ...LIVE_ENV, NOD_DEMO_VENDOR: badChecksum } });
    const res = await send(api, get('/api/demo-agent'));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/checksum/);
  });
});

// ---------------------------------------------------------------------------
// GET /api/config
// ---------------------------------------------------------------------------

describe('GET /api/config', () => {
  it('reports contracts, a reachable live HSP with its option, and the demo price', async () => {
    const hsp = fakeHsp();
    const res = await send(apiWith({ hsp: hsp.client, env: { ...LIVE_ENV, NOD_POLICY_ADDRESS: OTHER.toLowerCase() } }), get('/api/config'));
    expect(res.status).toBe(200);
    expect(res.res.headers.get('cache-control')).toBe('no-store');
    expect(res.body).toEqual({
      receipts: { chainId: 133, address: RECEIPTS, recorder: RECORDER, explorer: 'https://testnet-explorer.hskchain.net' },
      policy: { chainId: 133, address: OTHER },
      hsp: {
        mode: 'live',
        merchantName: 'Team Nod',
        reachable: true,
        option: { network: 'sepolia', chainId: 11155111, contractAddress: SEPOLIA_TEST_USDC, coin: 'USDC', decimals: 6, paymentProtocol: 'eip3009' },
      },
      demoUsd: '0.10',
    });
  });

  it('says HSP is unreachable, with the allowlist explanation', async () => {
    const hsp = fakeHsp({
      get_chain_config: () => {
        throw new HspUnavailableError('HSP at https://mcp-qa.hashkeymerchant.com/ refused the connection (HTTP 403). HSP only accepts allowlisted IPs: ...');
      },
    });
    const res = await send(apiWith({ hsp: hsp.client }), get('/api/config'));
    expect(res.status).toBe(200);
    expect(res.body.hsp.reachable).toBe(false);
    expect(res.body.hsp.error).toMatch(/HSP only accepts allowlisted IPs/);
    expect(res.body.hsp.option).toBeUndefined();
  });

  it('gives up on a silent HSP after 6 s', async () => {
    vi.useFakeTimers();
    try {
      const hsp = fakeHsp({ get_chain_config: () => new Promise(() => undefined) });
      const pending = send(apiWith({ hsp: hsp.client }), get('/api/config'));
      await vi.advanceTimersByTimeAsync(6_000);
      const res = await pending;
      expect(res.status).toBe(200);
      expect(res.body.hsp.reachable).toBe(false);
      expect(res.body.hsp.error).toMatch(/did not answer within 6 s\. HSP only accepts allowlisted IPs/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses mainnet receipts and flags a missing merchant name', async () => {
    const env = { HSP_MODE: 'live', NOD_RECEIPTS_CHAIN: 'hsk-mainnet' };
    const res = await send(apiWith({ hsp: fakeHsp().client, env }), get('/api/config'));
    expect(res.body.receipts).toEqual({ chainId: 177, address: null, recorder: null, explorer: 'https://hsk.blockscout.com' });
    expect(res.body.hsp.merchantName).toBeNull();
    expect(res.body.hsp.error).toMatch(/NOD_MERCHANT_NAME/);
  });

  it('runs the mock in mock mode', async () => {
    const res = await send(apiWith({ env: { HSP_MODE: 'mock' }, hsp: createMockHsp({ store: newMockStore() }) }), get('/api/config'));
    expect(res.body.hsp).toMatchObject({ mode: 'mock', merchantName: 'Nod (mock HSP)', reachable: true });
    expect(res.body.hsp.option).toMatchObject({ network: 'sepolia', chainId: 11155111, coin: 'USDC', paymentProtocol: 'eip3009' });
  });
});

// ---------------------------------------------------------------------------
// GET /api/demo-agent
// ---------------------------------------------------------------------------

describe('GET /api/demo-agent', () => {
  it('signs fresh terms with the configured key, payable to the demo vendor', async () => {
    const res = await send(apiWith({ hsp: fakeHsp().client }), get('/api/demo-agent'));
    expect(res.status).toBe(200);
    expect(res.body.warning).toBeUndefined();
    expect(res.body.link.startsWith(`${ORIGIN}/r#`)).toBe(true);
    const decoded = decodeLink(res.body.link);
    expect(decoded).toEqual(res.body.signed);
    expect(await verifyTerms(decoded)).toMatchObject({ valid: true, expired: false });
    expect(res.body.termsHash).toBe(hashTerms(decoded.terms));
    expect(decoded.terms).toMatchObject({
      merchant: 'Nod weather agent',
      purpose: '1 live weather report',
      amountUsd: '0.10',
      payTo: VENDOR,
      agent: AGENT,
    });
    const ttl = decoded.terms.expiry - Math.floor(Date.now() / 1000);
    expect(ttl).toBeGreaterThan(890);
    expect(ttl).toBeLessThanOrEqual(900);
  });

  it('falls back to an ephemeral key paid at its own address, with a warning', async () => {
    const res = await send(apiWith({ hsp: fakeHsp().client, env: { HSP_MODE: 'live' } }), get('/api/demo-agent'));
    expect(res.body.warning).toBe('ephemeral agent key');
    expect(res.body.signed.terms.payTo).toBe(res.body.signed.terms.agent);
    expect((await verifyTerms(res.body.signed)).valid).toBe(true);
  });

  it('uses NOD_PUBLIC_URL, NOD_DEMO_USD and forwarded proto/host', async () => {
    const env = { ...LIVE_ENV, NOD_DEMO_USD: '1.25', NOD_PUBLIC_URL: 'https://nod.example/' };
    const res = await send(apiWith({ hsp: fakeHsp().client, env }), get('/api/demo-agent'));
    expect(res.body.link.startsWith('https://nod.example/r#')).toBe(true);
    expect(res.body.signed.terms.amountUsd).toBe('1.25');
    const proxied = await send(
      apiWith({ hsp: fakeHsp().client }),
      get('/api/demo-agent', { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'pay.example' }),
    );
    expect(proxied.body.link.startsWith('https://pay.example/r#')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /api/pay/start
// ---------------------------------------------------------------------------

describe('POST /api/pay/start', () => {
  it('creates the HSP order and prepares the payment', async () => {
    const signed = await demoTerms();
    const hsp = fakeHsp();
    const res = await send(apiWith({ hsp: hsp.client }), post('/api/pay/start', { signed, payer: PAYER.toLowerCase() }));
    expect(res.status).toBe(200);
    expect(hsp.names()).toEqual(['get_chain_config', 'create_order', 'prepare_payment']);

    const order = hsp.calls[1]!.args;
    expect(order.merchant_name).toBe('Team Nod');
    expect(order.pay_to).toBe(VENDOR);
    expect(order.cart_mandate.contents.merchant_name).toBe('Team Nod');
    expect(order.cart_mandate.contents.payment_request.method_data[0].data).toEqual({
      x402Version: 2,
      network: 'sepolia',
      chain_id: 11155111,
      contract_address: SEPOLIA_TEST_USDC,
      pay_to: VENDOR,
      coin: 'USDC',
    });
    expect(order.cart_mandate.contents.payment_request.details.total.amount).toEqual({ currency: 'USD', value: '0.10' });
    expect(hsp.calls[2]!.args).toEqual({ flow_id: 'flow-1', payer: PAYER, protocol: 'eip3009' });

    const termsHash = hashTerms(signed.terms);
    expect(res.body).toEqual({
      flowId: 'flow-1',
      paymentRequestId: order.cart_mandate.contents.payment_request.details.id,
      termsHash,
      payTo: VENDOR,
      payer: PAYER,
      eip712: eip712For(PAYER),
      tokenTotalRaw: '100000',
      quoteExpiresAt: Date.parse('2030-01-01T00:05:00Z') / 1000,
      option: { network: 'sepolia', chainId: 11155111, contractAddress: SEPOLIA_TEST_USDC, coin: 'USDC', decimals: 6, paymentProtocol: 'eip3009' },
      opaque: { payment_payload: { opaque: 'payload' }, payment_mandate_contents: { payment_mandate_id: 'pm-1' }, cart_hash: '0xcafe' },
    });
    expect(res.body.paymentRequestId).toMatch(new RegExp(`^nodpr-${termsHash.slice(2, 18)}-[0-9a-f]{8}$`));
  });

  it('accepts the link payload and caches get_chain_config', async () => {
    const hsp = fakeHsp();
    const api = apiWith({ hsp: hsp.client });
    const signed = await demoTerms();
    expect((await send(api, post('/api/pay/start', { payload: `${ORIGIN}/r#${encodeLink(signed)}`, payer: PAYER }))).status).toBe(200);
    expect((await send(api, post('/api/pay/start', { payload: encodeLink(signed), payer: PAYER }))).status).toBe(200);
    expect(hsp.names().filter((n) => n === 'get_chain_config')).toHaveLength(1);
  });

  it('rejects bad terms, expired terms, a bad payer and a missing body', async () => {
    const api = apiWith({ hsp: fakeHsp().client });
    const signed = await demoTerms();
    const tampered = { ...signed, terms: { ...signed.terms, amountUsd: '0.01' } };
    const bad = await send(api, post('/api/pay/start', { signed: tampered, payer: PAYER }));
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('invalid_terms');
    expect(bad.body.error).toMatch(/Signed by/);

    const expired = await send(api, post('/api/pay/start', { signed: await expiredTerms(), payer: PAYER }));
    expect(expired.status).toBe(400);
    expect(expired.body.code).toBe('expired');

    expect((await send(api, post('/api/pay/start', { signed, payer: 'me' }))).body.code).toBe('bad_request');
    expect((await send(api, post('/api/pay/start', { payer: PAYER }))).status).toBe(400);
    expect((await send(api, post('/api/pay/start', 'not json'))).status).toBe(400);
    expect((await send(api, post('/api/pay/start', { payload: 'garbage!', payer: PAYER }))).body.code).toBe('invalid_terms');
  });

  it('answers 409 already_paid when our recorder anchored the terms', async () => {
    const signed = await demoTerms();
    const chains = fakeChains();
    chains.store(RECORDER, hashTerms(signed.terms), {
      settlementTx: TX,
      chainId: 11155111n,
      payer: PAYER,
      payTo: VENDOR,
      amount: 100_000n,
      anchoredAt: 1_900_000_000n,
    });
    const hsp = fakeHsp();
    const res = await send(apiWith({ hsp: hsp.client, chains: chains.access }), post('/api/pay/start', { signed, payer: PAYER }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('already_paid');
    expect(res.body.receipt).toMatchObject({ settlementTx: TX, chainId: 11155111, payer: PAYER, payTo: VENDOR, amount: '100000' });
    expect(hsp.calls).toHaveLength(0);
  });

  it('answers 503 hsp_unavailable with the allowlist explanation', async () => {
    const hsp = fakeHsp({
      get_chain_config: () => {
        throw new HspUnavailableError('Could not reach HSP at https://mcp-qa.hashkeymerchant.com/ (ECONNREFUSED). HSP only accepts allowlisted IPs: ...');
      },
    });
    const res = await send(apiWith({ hsp: hsp.client }), post('/api/pay/start', { signed: await demoTerms(), payer: PAYER }));
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('hsp_unavailable');
    expect(res.body.error).toMatch(/HSP only accepts allowlisted IPs/);
  });

  it('treats an HSP refusal in a tool result as hsp_unavailable', async () => {
    const hsp = fakeHsp({ get_chain_config: () => toolError('Forbidden: IP 203.0.113.9 is not allowlisted') });
    const res = await send(apiWith({ hsp: hsp.client }), post('/api/pay/start', { signed: await demoTerms(), payer: PAYER }));
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('hsp_unavailable');
    expect(res.body.error).toMatch(/HSP only accepts allowlisted IPs/);
  });

  it('needs NOD_MERCHANT_NAME in live mode', async () => {
    const env: Record<string, string> = { ...LIVE_ENV };
    delete env.NOD_MERCHANT_NAME;
    const res = await send(apiWith({ hsp: fakeHsp().client, env }), post('/api/pay/start', { signed: await demoTerms(), payer: PAYER }));
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('not_configured');
  });

  it('maps tool errors to 502 and refuses an authorization to the wrong recipient', async () => {
    const failing = fakeHsp({ create_order: () => toolError('{"code":40001,"msg":"cart_expiry too far"}') });
    const res = await send(apiWith({ hsp: failing.client }), post('/api/pay/start', { signed: await demoTerms(), payer: PAYER }));
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('hsp_error');
    expect(res.body.error).toMatch(/create_order failed: .*cart_expiry too far/);

    const hijacked = fakeHsp({
      prepare_payment: (args) =>
        text({ eip712: eip712For(args.payer, OTHER), payment_payload: 'p', payment_mandate_contents: 'c', cart_hash: 'h' }),
    });
    const res2 = await send(apiWith({ hsp: hijacked.client }), post('/api/pay/start', { signed: await demoTerms(), payer: PAYER }));
    expect(res2.status).toBe(502);
    expect(res2.body.code).toBe('hsp_mismatch');
  });

  it('honours NOD_PAY_* preferences', async () => {
    const res = await send(
      apiWith({ hsp: fakeHsp().client, env: { ...LIVE_ENV, NOD_PAY_NETWORK: 'hashkey-testnet' } }),
      post('/api/pay/start', { signed: await demoTerms(), payer: PAYER }),
    );
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('no_payment_option');
    expect(res.body.error).toMatch(/network hashkey-testnet/);
  });
});

// ---------------------------------------------------------------------------
// POST /api/pay/finish
// ---------------------------------------------------------------------------

describe('POST /api/pay/finish', () => {
  const opaque = { payment_payload: { opaque: 'payload' }, payment_mandate_contents: { payment_mandate_id: 'pm-1' }, cart_hash: '0xcafe' };
  const signature = `0x${'1b'.repeat(65)}`;

  it('finalizes and submits through HSP', async () => {
    const hsp = fakeHsp();
    const res = await send(
      apiWith({ hsp: hsp.client }),
      post('/api/pay/finish', { flowId: 'flow-1', paymentRequestId: 'nodpr-1', signature, opaque }),
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'payment-submitted', flowId: 'flow-1', paymentRequestId: 'nodpr-1' });
    expect(hsp.calls[0]).toEqual({ name: 'finalize_payment', args: { flow_id: 'flow-1', signature, ...opaque } });
    expect(hsp.calls[1]).toEqual({ name: 'submit_payment', args: { flow_id: 'flow-1', payment_mandate_json: '{"mandate":1}' } });
  });

  it('answers 409 quote_expired when the quote ran out', async () => {
    const hsp = fakeHsp({ finalize_payment: () => toolError('{"code":30043,"msg":"quote expired"}') });
    const res = await send(apiWith({ hsp: hsp.client }), post('/api/pay/finish', { flowId: 'f', paymentRequestId: 'p', signature, opaque }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('quote_expired');
  });

  it('validates the body', async () => {
    const api = apiWith({ hsp: fakeHsp().client });
    expect((await send(api, post('/api/pay/finish', { flowId: 'f', paymentRequestId: 'p', signature: '0x12', opaque }))).status).toBe(400);
    expect((await send(api, post('/api/pay/finish', { flowId: 'f', paymentRequestId: 'p', signature }))).body.error).toMatch(/opaque/);
    expect((await send(api, post('/api/pay/finish', { paymentRequestId: 'p', signature, opaque }))).body.error).toMatch(/flowId/);
  });
});

// ---------------------------------------------------------------------------
// GET /api/pay/status
// ---------------------------------------------------------------------------

describe('GET /api/pay/status', () => {
  it('reports a paid payment with its settlement transaction', async () => {
    const hsp = fakeHsp();
    const res = await send(apiWith({ hsp: hsp.client }), get('/api/pay/status?flowId=flow-1&paymentRequestId=nodpr-1'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'payment-safe',
      outcome: 'paid',
      txHash: TX,
      chainId: 11155111,
      network: 'sepolia',
      payer: PAYER,
      payTo: VENDOR,
      attributionVerified: true,
      explorerUrl: `https://sepolia.etherscan.io/tx/${TX}`,
    });
    const query = hsp.calls.find((c) => c.name === 'query_payment')!;
    expect(query.args).toEqual({ flow_id: 'flow-1', payment_request_id: 'nodpr-1', expected_merchant_name: 'Team Nod' });
  });

  it('maps pending, unknown and failed states', async () => {
    const statusOf = async (payment: Record<string, unknown>) =>
      (await send(apiWith({ hsp: fakeHsp({ query_payment: () => text({ payment }) }).client }), get('/api/pay/status?flowId=f'))).body;
    expect(await statusOf({ status: 'payment-processing' })).toEqual({ status: 'payment-processing', outcome: 'pending' });
    expect((await statusOf({ status: 'payment-quoted' })).outcome).toBe('pending');
    expect(await statusOf({ status: 'payment-failed', status_reason: 'insufficient balance' })).toEqual({
      status: 'payment-failed',
      outcome: 'failed',
      statusReason: 'insufficient balance',
    });
  });

  it('needs an id', async () => {
    const res = await send(apiWith({ hsp: fakeHsp().client }), get('/api/pay/status'));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/pay/settle
// ---------------------------------------------------------------------------

describe('POST /api/pay/settle', () => {
  it('checks the transfer on chain and anchors the receipt, once', async () => {
    const signed = await demoTerms();
    const termsHash = hashTerms(signed.terms);
    const chains = fakeChains({ [TX]: paidReceipt() });
    const api = apiWith({ hsp: fakeHsp().client, chains: chains.access });

    const res = await send(api, post('/api/pay/settle', { signed, flowId: 'flow-1', paymentRequestId: 'nodpr-1' }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      check: { ok: true, reasons: [], transferredRaw: '100000' },
      anchor: { txHash: ANCHOR_TX, explorerUrl: `https://testnet-explorer.hskchain.net/tx/${ANCHOR_TX}` },
    });
    expect(chains.anchors).toHaveLength(1);
    expect(chains.anchors[0]).toEqual({
      chainId: 133,
      contract: RECEIPTS,
      privateKey: RECORDER_KEY,
      args: { termsHash, settlementTx: TX, chainId: 11155111, payer: PAYER, payTo: VENDOR, amount: 100_000n },
    });
    expect(chains.access.reader).toHaveBeenCalledWith(11155111);

    const again = await send(api, post('/api/pay/settle', { payload: encodeLink(signed), flowId: 'flow-1' }));
    expect(again.status).toBe(200);
    expect(again.body.anchor).toEqual({
      already: true,
      receipt: {
        settlementTx: TX,
        chainId: 11155111,
        payer: PAYER,
        payTo: VENDOR,
        amount: '100000',
        anchoredAt: 1_900_000_000,
        settlementExplorerUrl: `https://sepolia.etherscan.io/tx/${TX}`,
      },
    });
    expect(chains.anchors).toHaveLength(1);
  });

  it('skips anchoring without a contract or a recorder key', async () => {
    const signed = await demoTerms();
    const chains = fakeChains({ [TX]: paidReceipt() });
    const noContract = { ...LIVE_ENV, NOD_RECEIPTS_ADDRESS: '' };
    const res = await send(apiWith({ hsp: fakeHsp().client, chains: chains.access, env: noContract }), post('/api/pay/settle', { signed, flowId: 'f' }));
    expect(res.body).toMatchObject({ ok: true, anchor: { skipped: true, reason: 'NOD_RECEIPTS_ADDRESS is not set' } });
    const noKey = { ...LIVE_ENV, NOD_RECORDER_KEY: '' };
    const res2 = await send(apiWith({ hsp: fakeHsp().client, chains: chains.access, env: noKey }), post('/api/pay/settle', { signed, flowId: 'f' }));
    expect(res2.body.anchor).toEqual({ skipped: true, reason: 'NOD_RECORDER_KEY is not set' });
    expect(chains.anchors).toHaveLength(0);
  });

  it('accepts expired terms (the payment was authorized before the expiry)', async () => {
    const chains = fakeChains({ [TX]: paidReceipt() });
    const res = await send(apiWith({ hsp: fakeHsp().client, chains: chains.access }), post('/api/pay/settle', { signed: await expiredTerms(), flowId: 'f' }));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('answers 409 not_paid while HSP is still processing', async () => {
    const hsp = fakeHsp({ query_payment: () => text({ payment: { status: 'payment-included' } }) });
    const res = await send(apiWith({ hsp: hsp.client }), post('/api/pay/settle', { signed: await demoTerms(), flowId: 'f' }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('not_paid');
    expect(res.body.status).toBe('payment-included');
  });

  it('answers 409 settlement_check_failed when the transfer is short', async () => {
    const chains = fakeChains({ [TX]: paidReceipt(50_000n) });
    const res = await send(apiWith({ hsp: fakeHsp().client, chains: chains.access }), post('/api/pay/settle', { signed: await demoTerms(), flowId: 'f' }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('settlement_check_failed');
    expect(res.body.ok).toBe(false);
    expect(res.body.check.reasons[0]).toMatch(/less than the 100000 required/);
    expect(chains.anchors).toHaveLength(0);
  });

  it('reports an anchoring failure without failing the verified payment', async () => {
    const chains = fakeChains({ [TX]: paidReceipt() });
    chains.access.anchor = async () => {
      throw new Error('insufficient funds for gas');
    };
    const res = await send(apiWith({ hsp: fakeHsp().client, chains: chains.access }), post('/api/pay/settle', { signed: await demoTerms(), flowId: 'f' }));
    expect(res.status).toBe(200);
    expect(res.body.anchor).toMatchObject({ skipped: true, failed: true });
    expect(res.body.anchor.reason).toMatch(/insufficient funds/);
  });
});

// ---------------------------------------------------------------------------
// GET /api/receipt
// ---------------------------------------------------------------------------

describe('GET /api/receipt', () => {
  const termsHash: Hex = `0x${'77'.repeat(32)}`;

  it('returns an anchored receipt with explorer links', async () => {
    const chains = fakeChains();
    chains.store(RECORDER, termsHash, { settlementTx: TX, chainId: 11155111n, payer: PAYER, payTo: VENDOR, amount: 100_000n, anchoredAt: 1_900_000_000n });
    const res = await send(apiWith({ hsp: fakeHsp().client, chains: chains.access }), get(`/api/receipt?termsHash=${termsHash}`));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      anchored: true,
      termsHash,
      chainId: 133,
      contract: RECEIPTS,
      recorder: RECORDER,
      receipt: {
        settlementTx: TX,
        chainId: 11155111,
        payer: PAYER,
        payTo: VENDOR,
        amount: '100000',
        anchoredAt: 1_900_000_000,
        settlementExplorerUrl: `https://sepolia.etherscan.io/tx/${TX}`,
      },
      explorer: {
        contract: `https://testnet-explorer.hskchain.net/address/${RECEIPTS}`,
        recorder: `https://testnet-explorer.hskchain.net/address/${RECORDER}`,
        settlementTx: `https://sepolia.etherscan.io/tx/${TX}`,
      },
    });
  });

  it('reports not anchored, an unconfigured contract, a bad hash and RPC failures', async () => {
    const chains = fakeChains();
    const api = apiWith({ hsp: fakeHsp().client, chains: chains.access });
    expect((await send(api, get(`/api/receipt?termsHash=${termsHash}`))).body).toMatchObject({ anchored: false, recorder: RECORDER });
    expect((await send(api, get(`/api/receipt?termsHash=${termsHash}&recorder=${OTHER}`))).body.recorder).toBe(OTHER);
    expect((await send(api, get('/api/receipt?termsHash=0x12'))).status).toBe(400);

    const unconfigured = apiWith({ hsp: fakeHsp().client, env: { HSP_MODE: 'live' } });
    expect((await send(unconfigured, get(`/api/receipt?termsHash=${termsHash}`))).body).toMatchObject({
      anchored: false,
      contract: null,
      reason: 'NOD_RECEIPTS_ADDRESS is not set',
    });

    chains.failReads();
    const down = await send(api, get(`/api/receipt?termsHash=${termsHash}`));
    expect(down.status).toBe(502);
    expect(down.body.code).toBe('chain_unavailable');
  });
});

// ---------------------------------------------------------------------------
// POST /api/vendor/buy
// ---------------------------------------------------------------------------

describe('POST /api/vendor/buy', () => {
  const weatherFetch = (async () =>
    new Response(JSON.stringify({ current: { time: '2026-11-22T10:00', temperature_2m: 7.5, relative_humidity_2m: 60, wind_speed_10m: 12 } }), {
      status: 200,
    })) as unknown as typeof fetch;

  it('delivers a live weather report once the payment is proven', async () => {
    const chains = fakeChains({ [TX]: paidReceipt() });
    const res = await send(
      apiWith({ hsp: fakeHsp().client, chains: chains.access, fetch: weatherFetch }),
      post('/api/vendor/buy', { signed: await demoTerms(), flowId: 'flow-1', paymentRequestId: 'nodpr-1' }),
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.item.title).toMatch(/^Weather report: /);
    expect(res.body.item.body).toMatch(/7\.5 °C, humidity 60%, wind 12 km\/h/);
    expect(typeof res.body.item.deliveredAt).toBe('number');
  });

  it('falls back to a canned report when the feed is down', async () => {
    const chains = fakeChains({ [TX]: paidReceipt() });
    const res = await send(
      apiWith({ hsp: fakeHsp().client, chains: chains.access, fetch: offlineFetch }),
      post('/api/vendor/buy', { signed: await demoTerms(), flowId: 'f' }),
    );
    expect(res.status).toBe(200);
    expect(res.body.item.body).toMatch(/live feed unavailable/);
  });

  it('answers 402 with reasons until paid', async () => {
    const hsp = fakeHsp({ query_payment: () => text({ payment: { status: 'payment-processing' } }) });
    const res = await send(apiWith({ hsp: hsp.client }), post('/api/vendor/buy', { signed: await demoTerms(), flowId: 'f' }));
    expect(res.status).toBe(402);
    expect(res.body).toEqual({ ok: false, reasons: ['HSP reports payment-processing'] });

    const chains = fakeChains({ [TX]: { status: 'success', logs: [] } });
    const res2 = await send(apiWith({ hsp: fakeHsp().client, chains: chains.access }), post('/api/vendor/buy', { signed: await demoTerms(), flowId: 'f' }));
    expect(res2.status).toBe(402);
    expect(res2.body.reasons[0]).toMatch(/no Transfer/);
  });

  it('only sells its own offer at its own price', async () => {
    const api = apiWith({ hsp: fakeHsp().client, chains: fakeChains({ [TX]: paidReceipt() }).access });
    const elsewhere = await send(api, post('/api/vendor/buy', { signed: await demoTerms({ payTo: OTHER }), flowId: 'f' }));
    expect(elsewhere.status).toBe(400);
    expect(elsewhere.body.code).toBe('not_demo_vendor');
    const cheap = await send(api, post('/api/vendor/buy', { signed: await demoTerms({ amountUsd: '0.05' }), flowId: 'f' }));
    expect(cheap.body.code).toBe('not_demo_vendor');
  });
});

// ---------------------------------------------------------------------------
// Mock HSP: the whole flow
// ---------------------------------------------------------------------------

describe('mock HSP flow', () => {
  function mockApi() {
    let clock = Date.parse('2026-11-22T10:00:00Z');
    const hsp = createMockHsp({ now: () => clock, store: newMockStore() });
    const api = createApi({ env: { HSP_MODE: 'mock', NOD_DEMO_AGENT_KEY: AGENT_KEY }, hsp, chains: fakeChains().access, fetch: offlineFetch, log: silentLogger });
    return { api, advance: (seconds: number) => (clock += seconds * 1000) };
  }

  it('runs start → sign → finish → status → settle → buy', async () => {
    const { api, advance } = mockApi();
    const demo = await send(api, get('/api/demo-agent'));
    expect(demo.status).toBe(200);

    const start = await send(api, post('/api/pay/start', { payload: demo.body.link, payer: PAYER }));
    expect(start.status).toBe(200);
    expect(start.body.option).toMatchObject({ network: 'sepolia', chainId: 11155111, contractAddress: SEPOLIA_TEST_USDC });
    expect(start.body.eip712.primaryType).toBe('TransferWithAuthorization');
    expect(start.body.eip712.domain).toEqual({ name: 'USDC', version: '2', chainId: 11155111, verifyingContract: SEPOLIA_TEST_USDC });
    expect(start.body.eip712.message).toMatchObject({ from: PAYER, to: demo.body.signed.terms.payTo, value: '100000' });
    expect(start.body.tokenTotalRaw).toBe('100000');
    expect(start.body.flowId).toMatch(/^mockflow_/);

    // The wallet signs the typed data unchanged.
    const signature = await PAYER_ACCOUNT.signTypedData(start.body.eip712);
    const { flowId, paymentRequestId, opaque } = start.body;
    const finish = await send(api, post('/api/pay/finish', { flowId, paymentRequestId, signature, opaque }));
    expect(finish.status).toBe(200);
    expect(finish.body).toEqual({ status: 'payment-submitted', flowId, paymentRequestId });

    const query = `/api/pay/status?flowId=${flowId}&paymentRequestId=${paymentRequestId}`;
    expect((await send(api, get(query))).body).toMatchObject({ status: 'payment-submitted', outcome: 'pending' });
    expect((await send(api, post('/api/vendor/buy', { payload: demo.body.link, flowId }))).status).toBe(402);

    advance(4);
    const processing = (await send(api, get(query))).body;
    expect(processing).toMatchObject({ status: 'payment-processing', outcome: 'pending', chainId: 11155111 });
    expect(processing.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    advance(MOCK_TIMELINE[MOCK_TIMELINE.length - 1]![0]);
    const paid = (await send(api, get(query))).body;
    expect(paid).toMatchObject({ status: 'payment-safe', outcome: 'paid', payer: PAYER, attributionVerified: true });
    expect(paid.explorerUrl).toBe(`https://sepolia.etherscan.io/tx/${paid.txHash}`);

    const settle = await send(api, post('/api/pay/settle', { signed: demo.body.signed, flowId, paymentRequestId }));
    expect(settle.status).toBe(200);
    expect(settle.body).toEqual({
      ok: true,
      check: { ok: true, reasons: [], skipped: true, reason: 'mock mode' },
      anchor: { skipped: true, reason: 'mock mode' },
    });

    const buy = await send(api, post('/api/vendor/buy', { signed: demo.body.signed, flowId, paymentRequestId }));
    expect(buy.status).toBe(200);
    expect(buy.body.item.title).toMatch(/^Weather report: /);
  });

  it('rejects a signature from another key', async () => {
    const { api } = mockApi();
    const start = await send(api, post('/api/pay/start', { signed: await demoTerms(), payer: PAYER }));
    const intruder = privateKeyToAccount(keyOf('intruder'));
    const signature = await intruder.signTypedData(start.body.eip712);
    const finish = await send(api, post('/api/pay/finish', { ...start.body, signature }));
    expect(finish.status).toBe(502);
    expect(finish.body.error).toMatch(/not by the payer/);
  });

  it('expires quotes after 5 minutes', async () => {
    const { api, advance } = mockApi();
    const start = await send(api, post('/api/pay/start', { signed: await demoTerms(), payer: PAYER }));
    const signature = await PAYER_ACCOUNT.signTypedData(start.body.eip712);
    advance(301);
    const finish = await send(api, post('/api/pay/finish', { ...start.body, signature }));
    expect(finish.status).toBe(409);
    expect(finish.body.code).toBe('quote_expired');
  });
});

// ---------------------------------------------------------------------------
// LiveHspClient against an in-process MCP server
// ---------------------------------------------------------------------------

describe('LiveHspClient', () => {
  const clients: LiveHspClient[] = [];
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close()));
  });

  /** A Streamable HTTP MCP server reached through an injected fetch (no network). */
  async function fakeHspServer() {
    const received: Array<{ name: string; arguments: Record<string, unknown> | undefined }> = [];
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), enableJsonResponse: true });
    const server = new Server({ name: 'fake-hsp', version: '9.9.9' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'create_order',
          description: 'Create an order',
          inputSchema: {
            type: 'object',
            properties: { merchantName: { type: 'string' }, pay_to: { type: 'string' }, cart_mandate: { type: 'string' } },
            required: ['merchantName', 'pay_to', 'cart_mandate'],
          },
        },
        {
          name: 'prepare_payment',
          inputSchema: { type: 'object', properties: { flow_id: { type: 'string' }, payer: { type: 'string' }, protocol: { type: 'string', enum: ['EIP-3009', 'Permit2'] } } },
        },
      ],
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      received.push({ name: request.params.name, arguments: request.params.arguments });
      return { content: [{ type: 'text', text: JSON.stringify({ flow_id: 'live-flow', echo: request.params.arguments }) }] };
    });
    await server.connect(transport);
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => transport.handleRequest(new Request(input, init))) as typeof fetch;
    return { received, fetchImpl, close: () => server.close() };
  }

  it('connects once, logs the live tools, and shapes arguments to the live schema', async () => {
    const fake = await fakeHspServer();
    const logs: string[] = [];
    const client = new LiveHspClient({ url: 'http://hsp.test/mcp', fetch: fake.fetchImpl, log: (line) => logs.push(line) });
    clients.push(client);

    const cart = { contents: { id: 'nod-1' } };
    const raw = await client.callTool('create_order', { merchant_name: 'Team Nod', pay_to: VENDOR, cart_mandate: cart, extra: 1 });
    expect(raw).toMatchObject({ content: [{ type: 'text' }] });
    expect(fake.received[0]).toEqual({
      name: 'create_order',
      arguments: { merchantName: 'Team Nod', pay_to: VENDOR, cart_mandate: JSON.stringify(cart) },
    });

    await client.callTool('prepare_payment', { flow_id: 'live-flow', payer: PAYER, protocol: 'eip3009' });
    expect(fake.received[1]!.arguments).toEqual({ flow_id: 'live-flow', payer: PAYER, protocol: 'EIP-3009' });

    const all = logs.join('\n');
    expect(all).toMatch(/connected to http:\/\/hsp\.test\/mcp \(fake-hsp 9\.9\.9\)/);
    expect(all).toMatch(/2 live tools/);
    expect(all).toMatch(/"merchantName"/);
    expect(all).toMatch(/documented tools missing from the live server: get_chain_config/);
    expect(logs.filter((l) => l.includes('connected to'))).toHaveLength(1);
    await fake.close();
  });

  it('maps HTTP 403 to hsp_unavailable with the allowlist explanation', async () => {
    const forbidden = (async () => new Response('<html>403 Forbidden: your IP is not on the allowlist</html>', { status: 403 })) as unknown as typeof fetch;
    const client = new LiveHspClient({ url: 'https://mcp-qa.hashkeymerchant.com/', fetch: forbidden, log: () => undefined });
    clients.push(client);
    const error = await client.callTool('get_chain_config', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HspUnavailableError);
    expect((error as Error).message).toMatch(/refused the connection \(HTTP 403\)/);
    expect((error as Error).message).toMatch(/HSP only accepts allowlisted IPs/);
  });

  it('maps network failures to hsp_unavailable', async () => {
    const refused = (async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
    }) as unknown as typeof fetch;
    const client = new LiveHspClient({ url: 'https://mcp-qa.hashkeymerchant.com/', fetch: refused, log: () => undefined });
    clients.push(client);
    const error = await client.callTool('get_chain_config', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HspUnavailableError);
    expect((error as Error).message).toMatch(/Could not reach HSP .*ECONNREFUSED/);
  });
});

describe('shapeArgs', () => {
  it('passes arguments through without a schema and fits them to one when given', () => {
    expect(shapeArgs(undefined, { a: 1, b: undefined })).toEqual({ args: { a: 1 }, notes: [] });
    const { args, notes } = shapeArgs(
      {
        type: 'object',
        properties: { flowId: { type: 'string' }, payload: { type: 'object' }, amount: { type: 'integer' }, mode: { type: 'string', enum: ['EIP3009'] } },
        required: ['flowId', 'signature'],
      },
      { flow_id: 'f', payload: '{"x":1}', amount: '5', mode: 'eip-3009', unknown: true },
    );
    expect(args).toEqual({ flowId: 'f', payload: { x: 1 }, amount: 5, mode: 'EIP3009' });
    expect(notes.join('\n')).toMatch(/unknown: dropped/);
    expect(notes.join('\n')).toMatch(/signature: required by the live schema but not sent/);
  });
});
