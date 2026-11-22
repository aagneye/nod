import { describe, expect, it } from 'vitest';
import {
  HSP_FAILED_STATE,
  HSP_PAID_STATES,
  HSP_PENDING_STATES,
  SEPOLIA_TEST_USDC,
  buildCartMandate,
  hashTerms,
  hspOutcome,
  isQuoteExpiredError,
  parseChainConfig,
  parseCreateOrderResult,
  parseFinalizeResult,
  parsePrepareResult,
  parseQueryResult,
  pickPaymentOption,
  unwrapToolResult,
  type HspPaymentOption,
} from '../src/index.js';
import {
  FIXED_EXPIRY,
  FIXED_TERMS,
  FIXED_TERMS_HASH,
  HSK_TEST_USDC,
  HSK_TEST_USDT,
  PAYER,
  VENDOR,
  option,
} from './fixtures.js';

const text = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const SEPOLIA_USDC_LOWER = SEPOLIA_TEST_USDC.toLowerCase();
const TX = `0x${'ab'.repeat(32)}` as const;

// ---------------------------------------------------------------------------
// Cart mandate
// ---------------------------------------------------------------------------

describe('buildCartMandate', () => {
  const short = FIXED_TERMS_HASH.slice(2, 18);

  it('builds exactly the PROTOCOL §2 shape', () => {
    const now = FIXED_EXPIRY - 600; // terms expire before now + 2h
    const cart = buildCartMandate({
      terms: FIXED_TERMS,
      termsHash: FIXED_TERMS_HASH,
      option: option(),
      merchantName: 'Team Nod',
      now,
    });
    expect(cart).toStrictEqual({
      contents: {
        id: expect.stringMatching(new RegExp(`^nod-${short}-[0-9a-f]{8}$`)),
        user_cart_confirmation_required: true,
        cart_expiry: '2030-01-01T00:00:00Z',
        merchant_name: 'Team Nod',
        payment_request: {
          method_data: [
            {
              supported_methods: 'https://www.x402.org/',
              data: {
                x402Version: 2,
                network: 'hashkey-testnet',
                chain_id: 133,
                contract_address: HSK_TEST_USDC,
                pay_to: VENDOR,
                coin: 'USDC',
              },
            },
          ],
          details: {
            id: expect.stringMatching(new RegExp(`^nodpr-${short}-[0-9a-f]{8}$`)),
            display_items: [
              { label: 'Acme Weather: 1000 forecast API calls', amount: { currency: 'USD', value: '12.50' } },
            ],
            total: { label: 'Total', amount: { currency: 'USD', value: '12.50' } },
          },
        },
      },
    });
    // Key order matches the spec, too.
    expect(Object.keys(cart.contents)).toEqual([
      'id',
      'user_cart_confirmation_required',
      'cart_expiry',
      'merchant_name',
      'payment_request',
    ]);
  });

  it('clamps cart_expiry to now + 2h', () => {
    const now = FIXED_EXPIRY - 10_000;
    const cart = buildCartMandate({ terms: FIXED_TERMS, termsHash: FIXED_TERMS_HASH, option: option(), merchantName: 'Team Nod', now });
    expect(cart.contents.cart_expiry).toBe('2029-12-31T23:13:20Z');
    expect(Date.parse(cart.contents.cart_expiry) / 1000).toBe(now + 7200);
  });

  it('uses fresh random suffixes on the same termsHash prefix', () => {
    const build = () =>
      buildCartMandate({ terms: FIXED_TERMS, termsHash: FIXED_TERMS_HASH, option: option(), merchantName: 'Team Nod', now: FIXED_EXPIRY - 60 });
    const a = build();
    const b = build();
    expect(a.contents.id).not.toBe(b.contents.id);
    expect(a.contents.id.slice(0, 21)).toBe(b.contents.id.slice(0, 21));
    expect(a.contents.payment_request.details.id).not.toBe(b.contents.payment_request.details.id);
  });

  it('takes pay_to from the terms and token fields from the HSP option', () => {
    const sepolia = option({ network: 'sepolia', chainId: 11155111, contractAddress: SEPOLIA_TEST_USDC, coin: 'USDC' });
    const cart = buildCartMandate({ terms: FIXED_TERMS, termsHash: FIXED_TERMS_HASH, option: sepolia, merchantName: 'Team Nod', now: FIXED_EXPIRY - 60 });
    expect(cart.contents.payment_request.method_data[0]!.data).toEqual({
      x402Version: 2,
      network: 'sepolia',
      chain_id: 11155111,
      contract_address: SEPOLIA_TEST_USDC,
      pay_to: VENDOR,
      coin: 'USDC',
    });
  });

  it('trims the display label to 120 characters without splitting a character', () => {
    const long = { ...FIXED_TERMS, merchant: 'M'.repeat(64), purpose: 'p'.repeat(140) };
    const hash = hashTerms(long);
    const label = buildCartMandate({ terms: long, termsHash: hash, option: option(), merchantName: 'Team Nod', now: FIXED_EXPIRY - 60 })
      .contents.payment_request.details.display_items[0]!.label;
    expect(label).toHaveLength(120);
    expect(label.startsWith(`${'M'.repeat(64)}: p`)).toBe(true);

    const emoji = { ...FIXED_TERMS, merchant: 'M', purpose: `${'x'.repeat(116)}😀😀` };
    const emojiLabel = buildCartMandate({ terms: emoji, termsHash: hashTerms(emoji), option: option(), merchantName: 'Team Nod', now: FIXED_EXPIRY - 60 })
      .contents.payment_request.details.display_items[0]!.label;
    expect(emojiLabel).toBe(`M: ${'x'.repeat(116)}`);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(emojiLabel)).toBe(false);
  });

  it('refuses expired terms, a mismatched hash, a missing merchant name or a bad option', () => {
    const base = { terms: FIXED_TERMS, termsHash: FIXED_TERMS_HASH, option: option(), merchantName: 'Team Nod', now: FIXED_EXPIRY - 60 };
    expect(() => buildCartMandate({ ...base, now: FIXED_EXPIRY })).toThrow(/expired/);
    expect(() => buildCartMandate({ ...base, termsHash: `0x${'00'.repeat(32)}` })).toThrow(/does not match/);
    expect(() => buildCartMandate({ ...base, termsHash: FIXED_TERMS_HASH.toUpperCase().replace('0X', '0x') as `0x${string}` })).not.toThrow();
    expect(() => buildCartMandate({ ...base, merchantName: ' ' })).toThrow(/merchantName/);
    expect(() => buildCartMandate({ ...base, option: option({ contractAddress: '0x1234' }) })).toThrow(/payment option/);
    expect(() => buildCartMandate({ ...base, option: option({ chainId: 0 }) })).toThrow(/payment option/);
    expect(() => buildCartMandate({ ...base, terms: { ...FIXED_TERMS, amountUsd: '0' } })).toThrow(/amountUsd/);
  });
});

// ---------------------------------------------------------------------------
// get_chain_config
// ---------------------------------------------------------------------------

describe('parseChainConfig', () => {
  const nested = {
    networks: [
      {
        network: 'sepolia',
        chain_id: 11155111,
        tokens: [{ coin: 'USDC', address: SEPOLIA_USDC_LOWER, decimals: 6, payment_protocol: 'eip3009' }],
      },
      {
        network: 'hashkey-testnet',
        chain_id: 133,
        tokens: [
          { coin: 'USDC', address: HSK_TEST_USDC, decimals: 6, payment_protocol: 'eip3009' },
          { symbol: 'USDT', address: HSK_TEST_USDT, decimals: 6, payment_protocol: 'permit2' },
        ],
      },
    ],
  };
  const nestedOptions: HspPaymentOption[] = [
    { network: 'sepolia', chainId: 11155111, contractAddress: SEPOLIA_TEST_USDC, coin: 'USDC', decimals: 6, paymentProtocol: 'eip3009' },
    { network: 'hashkey-testnet', chainId: 133, contractAddress: HSK_TEST_USDC, coin: 'USDC', decimals: 6, paymentProtocol: 'eip3009' },
    { network: 'hashkey-testnet', chainId: 133, contractAddress: HSK_TEST_USDT, coin: 'USDT', decimals: 6, paymentProtocol: 'permit2' },
  ];

  it('reads networks with nested token lists (snake_case)', () => {
    expect(parseChainConfig(nested)).toEqual(nestedOptions);
  });

  it('reads a flat camelCase token list inside an envelope', () => {
    const flat = {
      code: 0,
      msg: 'success',
      data: {
        tokens: [
          {
            network: 'eip155:11155111',
            chainId: '0xaa36a7',
            symbol: 'USDC',
            contractAddress: SEPOLIA_USDC_LOWER,
            decimals: '6',
            paymentProtocol: 'EIP-3009',
          },
          {
            networkName: 'hsk-testnet',
            chainId: 133,
            tokenSymbol: 'USDC',
            tokenAddress: HSK_TEST_USDC,
            tokenDecimals: 6,
            paymentProtocols: ['permit2', 'eip3009'],
          },
        ],
      },
    };
    expect(parseChainConfig(flat)).toEqual([
      { network: 'eip155:11155111', chainId: 11155111, contractAddress: SEPOLIA_TEST_USDC, coin: 'USDC', decimals: 6, paymentProtocol: 'eip3009' },
      { network: 'hsk-testnet', chainId: 133, contractAddress: HSK_TEST_USDC, coin: 'USDC', decimals: 6, paymentProtocol: 'permit2' },
      { network: 'hsk-testnet', chainId: 133, contractAddress: HSK_TEST_USDC, coin: 'USDC', decimals: 6, paymentProtocol: 'eip3009' },
    ]);
  });

  it('reads maps keyed by network and coin, inheriting the protocol', () => {
    const keyed = {
      chains: {
        'hashkey-testnet': {
          chain_id: 133,
          payment_protocol: 'eip3009',
          tokens: { USDC: { contract_address: HSK_TEST_USDC, decimals: 6 } },
        },
        sepolia: {
          tokens: { USDC: { address: SEPOLIA_TEST_USDC, decimals: 6, protocols: 'eip3009,permit2' } },
        },
      },
    };
    expect(parseChainConfig(keyed)).toEqual([
      { network: 'hashkey-testnet', chainId: 133, contractAddress: HSK_TEST_USDC, coin: 'USDC', decimals: 6, paymentProtocol: 'eip3009' },
      { network: 'sepolia', chainId: 11155111, contractAddress: SEPOLIA_TEST_USDC, coin: 'USDC', decimals: 6, paymentProtocol: 'eip3009' },
      { network: 'sepolia', chainId: 11155111, contractAddress: SEPOLIA_TEST_USDC, coin: 'USDC', decimals: 6, paymentProtocol: 'permit2' },
    ]);
  });

  it('reads x402-style CAIP ids and a network named by `chain`', () => {
    const caip = {
      supported: [
        { chain: 'hashkey-testnet', chain_id: 133, asset: `eip155:133/erc20:${HSK_TEST_USDC}`, coin: 'USDC', decimals: 6, payment_protocol: 'eip3009' },
        { network: 'eip155:11155111', asset: `eip155:11155111/erc20:${SEPOLIA_USDC_LOWER}`, decimals: 6, scheme: 'exact', assetTransferMethod: 'permit2', symbol: 'USDC' },
      ],
    };
    expect(parseChainConfig(caip)).toEqual([
      { network: 'hashkey-testnet', chainId: 133, contractAddress: HSK_TEST_USDC, coin: 'USDC', decimals: 6, paymentProtocol: 'eip3009' },
      { network: 'eip155:11155111', chainId: 11155111, contractAddress: SEPOLIA_TEST_USDC, coin: 'USDC', decimals: 6, paymentProtocol: 'permit2' },
    ]);
  });

  it('unwraps MCP tool results and JSON text', () => {
    expect(parseChainConfig(text(nested))).toEqual(nestedOptions);
    expect(parseChainConfig({ structuredContent: nested, content: [{ type: 'text', text: 'ignored' }] })).toEqual(nestedOptions);
    expect(parseChainConfig(JSON.stringify(nested))).toEqual(nestedOptions);
    expect(parseChainConfig([nested.networks[0]])).toEqual([nestedOptions[0]]);
  });

  it('skips incomplete entries and returns [] when nothing is usable', () => {
    expect(parseChainConfig({ foo: 'bar' })).toEqual([]);
    expect(parseChainConfig([])).toEqual([]);
    expect(parseChainConfig(null)).toEqual([]);
    expect(
      parseChainConfig({
        networks: [
          {
            network: 'hashkey-testnet',
            chain_id: 133,
            tokens: [
              { coin: 'USDC', address: HSK_TEST_USDC, payment_protocol: 'eip3009' }, // no decimals
              { coin: 'USDC', address: HSK_TEST_USDC, decimals: 6 }, // no protocol
              { coin: 'USDC', address: 'not-an-address', decimals: 6, payment_protocol: 'eip3009' },
              { address: HSK_TEST_USDT, decimals: 6, payment_protocol: 'eip3009' }, // no coin
              { coin: 'USDC', address: HSK_TEST_USDC, decimals: 6, payment_protocol: 'x402-magic' },
            ],
          },
          { chain_id: 999, tokens: [{ coin: 'USDC', address: HSK_TEST_USDC, decimals: 6, payment_protocol: 'eip3009' }] }, // no network
        ],
      }),
    ).toEqual([]);
  });

  it('deduplicates repeated entries', () => {
    const twice = { networks: [nested.networks[1], nested.networks[1]] };
    expect(parseChainConfig(twice)).toEqual(nestedOptions.slice(1));
  });

  it('throws the tool error text for an MCP error result', () => {
    expect(() => parseChainConfig({ isError: true, content: [{ type: 'text', text: 'IP not allowlisted' }] })).toThrow(
      /get_chain_config failed: IP not allowlisted/,
    );
  });
});

// ---------------------------------------------------------------------------
// pickPaymentOption
// ---------------------------------------------------------------------------

describe('pickPaymentOption', () => {
  const sepoliaUsdc = option({ network: 'sepolia', chainId: 11155111, contractAddress: SEPOLIA_TEST_USDC });
  const hskUsdt = option({ coin: 'USDT', contractAddress: HSK_TEST_USDT, paymentProtocol: 'permit2' });
  const hskUsdcPermit2 = option({ paymentProtocol: 'permit2' });
  const hskUsdc3009 = option();
  const options = [sepoliaUsdc, hskUsdt, hskUsdcPermit2, hskUsdc3009];

  it('prefers HSK Chain testnet USDC, over EIP-3009 when both protocols are offered', () => {
    expect(pickPaymentOption(options)).toBe(hskUsdc3009);
    expect(pickPaymentOption([hskUsdcPermit2, sepoliaUsdc])).toBe(hskUsdcPermit2);
  });

  it('falls back to the first USDC, then to the first option', () => {
    const baseUsdc = option({ network: 'base-sepolia', chainId: 84532, contractAddress: '0x3333333333333333333333333333333333333333' });
    const sepoliaUsdt = option({ network: 'sepolia', chainId: 11155111, coin: 'USDT', contractAddress: HSK_TEST_USDT });
    expect(pickPaymentOption([sepoliaUsdt, sepoliaUsdc, baseUsdc])).toBe(sepoliaUsdc);
    const dai = option({ network: 'sepolia', chainId: 11155111, coin: 'DAI', contractAddress: HSK_TEST_USDT });
    expect(pickPaymentOption([sepoliaUsdt, dai])).toBe(sepoliaUsdt);
  });

  it('does not switch networks to get EIP-3009', () => {
    const sepoliaPermit2 = { ...sepoliaUsdc, paymentProtocol: 'permit2' as const };
    const base3009 = option({ network: 'base-sepolia', chainId: 84532, contractAddress: '0x3333333333333333333333333333333333333333' });
    expect(pickPaymentOption([sepoliaPermit2, base3009])).toBe(sepoliaPermit2);
  });

  it('applies preferences as filters', () => {
    expect(pickPaymentOption(options, { network: 'sepolia' })).toBe(sepoliaUsdc);
    expect(pickPaymentOption(options, { network: 'SEPOLIA' })).toBe(sepoliaUsdc);
    expect(pickPaymentOption(options, { network: '133' })).toBe(hskUsdc3009);
    expect(pickPaymentOption(options, { chainId: 11155111 })).toBe(sepoliaUsdc);
    expect(pickPaymentOption(options, { chainId: 133, coin: 'usdt' })).toBe(hskUsdt);
    expect(pickPaymentOption(options, { network: '' })).toBe(hskUsdc3009);
  });

  it('throws when nothing matches', () => {
    expect(() => pickPaymentOption([])).toThrow(/no payment options/);
    expect(() => pickPaymentOption(options, { network: 'base' })).toThrow(/network base.*offered: USDC on sepolia/);
    expect(() => pickPaymentOption(options, { chainId: 133, coin: 'DAI' })).toThrow(/coin DAI/);
  });
});

// ---------------------------------------------------------------------------
// MCP results
// ---------------------------------------------------------------------------

describe('unwrapToolResult', () => {
  it('parses JSON text content', () => {
    expect(unwrapToolResult(text({ a: 1 }))).toEqual({ a: 1 });
    expect(unwrapToolResult({ content: [{ type: 'image', data: '' }, { type: 'text', text: '[1,2]' }] })).toEqual([1, 2]);
    expect(unwrapToolResult({ content: [{ type: 'text', text: JSON.stringify(JSON.stringify({ a: 1 })) }] })).toEqual({ a: 1 });
  });

  it('prefers structuredContent', () => {
    expect(unwrapToolResult({ structuredContent: { b: 2 }, content: [{ type: 'text', text: '{"a":1}' }] })).toEqual({ b: 2 });
  });

  it('throws the tool error text when isError is set', () => {
    expect(() =>
      unwrapToolResult({ isError: true, content: [{ type: 'text', text: 'quote expired (30043)' }] }, 'prepare_payment'),
    ).toThrow('prepare_payment failed: quote expired (30043)');
    expect(() => unwrapToolResult({ isError: true, structuredContent: { code: 1 } })).toThrow(/HSP tool failed: \{"code":1\}/);
    expect(() => unwrapToolResult({ isError: true, content: [] })).toThrow(/no error text/);
  });

  it('passes plain objects through and parses JSON strings', () => {
    const plain = { flow_id: 'f' };
    expect(unwrapToolResult(plain)).toBe(plain);
    expect(unwrapToolResult('{"x":true}')).toEqual({ x: true });
  });

  it('throws on content that is not JSON', () => {
    expect(() => unwrapToolResult({ content: [{ type: 'text', text: 'hello' }] }, 'query_payment')).toThrow(
      /query_payment returned text that is not JSON: hello/,
    );
    expect(() => unwrapToolResult({ content: [] })).toThrow(/no content/);
    expect(() => unwrapToolResult('nope')).toThrow(/not JSON/);
  });
});

describe('isQuoteExpiredError', () => {
  it('spots Gateway code 30043 and quote-expired messages', () => {
    expect(isQuoteExpiredError(new Error('prepare_payment failed: {"code":30043,"msg":"x"}'))).toBe(true);
    expect(isQuoteExpiredError(new Error('submit_payment failed: Quote has expired'))).toBe(true);
    expect(isQuoteExpiredError({ code: 30043 })).toBe(true);
    expect(isQuoteExpiredError(new Error('insufficient balance'))).toBe(false);
  });
});

describe('parseCreateOrderResult', () => {
  it('reads flow id, payment request id and payment url', () => {
    expect(
      parseCreateOrderResult(text({ flow_id: 'flow-1', payment_request_id: 'nodpr-abc', payment_url: 'https://pay.example/x' })),
    ).toEqual({ flowId: 'flow-1', paymentRequestId: 'nodpr-abc', paymentUrl: 'https://pay.example/x' });
    expect(parseCreateOrderResult({ data: { flowId: 'flow-2', paymentRequestId: 'nodpr-def' } })).toEqual({
      flowId: 'flow-2',
      paymentRequestId: 'nodpr-def',
    });
  });

  it('falls back to the cart details id and fails without a flow id', () => {
    const cart = buildCartMandate({ terms: FIXED_TERMS, termsHash: FIXED_TERMS_HASH, option: option(), merchantName: 'Team Nod', now: FIXED_EXPIRY - 60 });
    expect(parseCreateOrderResult({ flow_id: 'flow-3' }, cart).paymentRequestId).toBe(cart.contents.payment_request.details.id);
    expect(() => parseCreateOrderResult({ flow_id: 'flow-3' })).toThrow(/payment_request_id/);
    expect(() => parseCreateOrderResult({ payment_request_id: 'x' })).toThrow(/flow_id/);
  });
});

describe('parsePrepareResult', () => {
  const eip712 = {
    domain: { name: 'USD Coin', version: '2', chainId: 133, verifyingContract: HSK_TEST_USDC },
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
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
    message: {
      from: PAYER,
      to: VENDOR,
      value: '12500000',
      validAfter: '0',
      validBefore: '1893456300',
      nonce: `0x${'12'.repeat(32)}`,
    },
  };
  const prepared = {
    eip712,
    token_total_raw: '12500000',
    quote_expires_at: '2029-12-31T23:05:00Z',
    payment_payload: 'opaque-payload',
    payment_mandate_contents: { payment_mandate_id: 'pm-1', total: { currency: 'USD', value: '12.50' } },
    cart_hash: '0xcafe',
    payment_request_id: 'nodpr-abc',
    pay_to: VENDOR.toLowerCase(),
    payer: PAYER.toLowerCase(),
  };

  it('reads a text-content result', () => {
    expect(parsePrepareResult(text(prepared))).toEqual({
      eip712,
      chainId: 133,
      tokenTotalRaw: 12_500_000n,
      quoteExpiresAt: Date.parse('2029-12-31T23:05:00Z') / 1000,
      payTo: VENDOR,
      payer: PAYER,
      paymentRequestId: 'nodpr-abc',
      opaque: {
        payment_payload: 'opaque-payload',
        payment_mandate_contents: prepared.payment_mandate_contents,
        cart_hash: '0xcafe',
      },
    });
  });

  it('reads structuredContent with camelCase keys, a JSON-string eip712 and millisecond expiry', () => {
    const result = parsePrepareResult({
      structuredContent: {
        result: {
          eip712: JSON.stringify(eip712),
          tokenTotalRaw: 12500000,
          quoteExpiresAt: 1893455100000,
          paymentPayload: { x402: true },
          paymentMandateContents: 'pmc',
          cartHash: 'hash',
        },
      },
    });
    expect(result.eip712).toEqual(eip712);
    expect(result.tokenTotalRaw).toBe(12_500_000n);
    expect(result.quoteExpiresAt).toBe(1893455100);
    expect(result.opaque).toEqual({ payment_payload: { x402: true }, payment_mandate_contents: 'pmc', cart_hash: 'hash' });
  });

  it('falls back to the signed message for amount, expiry, payee and payer', () => {
    const { token_total_raw, quote_expires_at, pay_to, payer, ...rest } = prepared;
    const result = parsePrepareResult(rest);
    expect(result.tokenTotalRaw).toBe(12_500_000n);
    expect(result.quoteExpiresAt).toBe(1893456300);
    expect(result.payTo).toBe(VENDOR);
    expect(result.payer).toBe(PAYER);
  });

  it('throws clearly when eip712 or an opaque field is missing', () => {
    const { eip712: _drop, ...noEip712 } = prepared;
    expect(() => parsePrepareResult(noEip712)).toThrow(/no usable eip712/);
    expect(() => parsePrepareResult({ ...prepared, eip712: { domain: {}, types: {} } })).toThrow(/no usable eip712/);
    const { cart_hash: _c, payment_payload: _p, ...noOpaque } = prepared;
    expect(() => parsePrepareResult(noOpaque)).toThrow(/missing payment_payload, cart_hash/);
    expect(() => parsePrepareResult({ isError: true, content: [{ type: 'text', text: 'flow not found' }] })).toThrow(
      /prepare_payment failed: flow not found/,
    );
  });
});

describe('parseFinalizeResult', () => {
  it('returns payment_mandate_json unchanged', () => {
    expect(parseFinalizeResult(text({ payment_mandate_json: '{"a":1}' }))).toEqual({ paymentMandateJson: '{"a":1}' });
    const mandate = { payment_mandate_contents: {}, user_authorization: 'jwt' };
    expect(parseFinalizeResult({ structuredContent: { paymentMandateJson: mandate } }).paymentMandateJson).toEqual(mandate);
    expect(() => parseFinalizeResult({ ok: true })).toThrow(/payment_mandate_json/);
  });
});

describe('parseQueryResult and status helpers', () => {
  it('reads a paid payment', () => {
    const raw = text({
      payment: {
        status: 'payment-safe',
        tx_signature: TX,
        to_pay_address: VENDOR.toLowerCase(),
        payer_address: PAYER.toLowerCase(),
        network: 'hashkey-testnet',
        status_reason: null,
      },
      attribution_verified: true,
    });
    expect(parseQueryResult(raw)).toEqual({
      status: 'payment-safe',
      outcome: 'paid',
      txHash: TX,
      network: 'hashkey-testnet',
      payer: PAYER,
      payTo: VENDOR,
      attributionVerified: true,
    });
  });

  it('reads a failed payment with its reason, inside an envelope', () => {
    const result = parseQueryResult({
      code: 0,
      data: { payment: { status: 'payment-failed', status_reason: 'insufficient balance' }, attribution_verified: 'false' },
    });
    expect(result).toEqual({
      status: 'payment-failed',
      outcome: 'failed',
      statusReason: 'insufficient balance',
      attributionVerified: false,
    });
  });

  it('accepts flat camelCase results and bare tx hashes', () => {
    const result = parseQueryResult({ status: 'payment-included', txSignature: 'ab'.repeat(32), payerAddress: PAYER });
    expect(result).toEqual({ status: 'payment-included', outcome: 'pending', txHash: TX, payer: PAYER });
  });

  it('throws without a status', () => {
    expect(() => parseQueryResult({ payment: { tx_signature: TX } })).toThrow(/no status/);
  });

  it('classifies every documented status', () => {
    for (const s of HSP_PAID_STATES) expect(hspOutcome(s)).toBe('paid');
    for (const s of HSP_PENDING_STATES) expect(hspOutcome(s)).toBe('pending');
    expect(hspOutcome(HSP_FAILED_STATE)).toBe('failed');
    expect(hspOutcome('PAYMENT_FINALIZED')).toBe('paid');
    expect(hspOutcome('payment-created')).toBe('unknown');
    expect(HSP_PENDING_STATES).toEqual([
      'payment-submitted',
      'payment-verified',
      'payment-processing',
      'payment-included',
      'payment-timeout',
    ]);
  });
});
