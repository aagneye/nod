import type { Address, Hex } from 'viem';
import type { HspPaymentOption, NodTerms } from '../src/index.js';

/** keccak256("nod-test-agent") */
export const AGENT_KEY: Hex = '0xd0c080c99c2ef1805f81d242fc3bbfa3fbb2221736a2f8554833d5162d73a6a7';
export const AGENT: Address = '0x1DE6C32F237f76e6cD30062e00C01dda00ad33Db';
/** keccak256("nod-test-other") */
export const OTHER_KEY: Hex = '0x623026ec77953bc56085d34064a2fa0e8bda43dc70b30fbf5d2cf3ff5c38e240';
export const OTHER: Address = '0x0f86B6889886F79B415C78A4E3caE2a2A44C6F06';
/** Address of keccak256("nod-test-vendor") */
export const VENDOR: Address = '0x24b1FfB060a2e9B70A984ADD79105F149A61C02A';
export const PAYER: Address = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';

/** 2030-01-01T00:00:00Z */
export const FIXED_EXPIRY = 1893456000;

export const FIXED_TERMS: NodTerms = {
  v: 2,
  id: '0x0123456789abcdef0123456789abcdef',
  merchant: 'Acme Weather',
  payTo: VENDOR,
  amountUsd: '12.50',
  purpose: '1000 forecast API calls',
  expiry: FIXED_EXPIRY,
  agent: AGENT,
};

/** hashTypedData of FIXED_TERMS, computed once with viem and cross-checked by a manual EIP-712 encoding. */
export const FIXED_TERMS_HASH: Hex = '0x871662d684dae91ca129cc9207fd904247b85b54056ac97161c34493ee1f0830';

export const HSK_TEST_USDC: Address = '0x1111111111111111111111111111111111111111';
export const HSK_TEST_USDT: Address = '0x2222222222222222222222222222222222222222';

export const option = (overrides: Partial<HspPaymentOption> = {}): HspPaymentOption => ({
  network: 'hashkey-testnet',
  chainId: 133,
  contractAddress: HSK_TEST_USDC,
  coin: 'USDC',
  decimals: 6,
  paymentProtocol: 'eip3009',
  ...overrides,
});
