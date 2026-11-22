/**
 * Networks Nod talks to (PROTOCOL §5): HSK Chain mainnet and testnet, plus Ethereum Sepolia,
 * where HSP's test USDC lives.
 */
import { defineChain, getAddress, type Address, type Chain, type Hash } from 'viem';
import { sepolia } from 'viem/chains';

export { sepolia };

const HSK_MAINNET = {
  id: 177,
  name: 'HashKey Chain',
  nativeCurrency: { name: 'HashKey Platform Token', symbol: 'HSK', decimals: 18 },
  rpcUrls: { default: { http: ['https://mainnet.hsk.xyz'] } },
  blockExplorers: { default: { name: 'HSK Chain Explorer', url: 'https://hsk.blockscout.com' } },
  contracts: {
    multicall3: { address: '0xca11bde05977b3631167028862be2a173976ca11', blockCreated: 0 },
  },
} as const;

const HSK_TESTNET = {
  id: 133,
  name: 'HashKey Chain Testnet',
  nativeCurrency: { name: 'HashKey Platform Token', symbol: 'HSK', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet.hsk.xyz'] } },
  blockExplorers: {
    default: { name: 'HSK Chain Testnet Explorer', url: 'https://testnet-explorer.hskchain.net' },
  },
  testnet: true,
} as const;

// Annotated so the emitted declarations do not reference viem's internal type paths.
export const hskMainnet: Chain & typeof HSK_MAINNET = /*#__PURE__*/ defineChain(HSK_MAINNET);
export const hskTestnet: Chain & typeof HSK_TESTNET = /*#__PURE__*/ defineChain(HSK_TESTNET);

/** Every chain Nod knows, in display order. */
export const SUPPORTED_CHAINS: readonly Chain[] = [hskMainnet, hskTestnet, sepolia];

/** HSK Chain mainnet stablecoins. HSP payment tokens still always come from `get_chain_config`. */
export const HSK_MAINNET_TOKENS = {
  /** Bridged USDC. */
  USDC: getAddress('0x054ed45810DbBAb8B27668922D110669c9D88D0a'),
  USDT: getAddress('0xf1b50ed67a9e2cc94ad3c477779e2d4cbfff9029'),
} as const;

/** Circle's test USDC on Ethereum Sepolia. */
export const SEPOLIA_TEST_USDC = getAddress('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238');

/** HSK Chain testnet faucet. */
export const HSK_TESTNET_FAUCET_URL = 'https://faucet.hsk.xyz/faucet';

/** The chain with this id, or `undefined` when Nod does not know it. */
export function findChain(chainId: number): Chain | undefined {
  return SUPPORTED_CHAINS.find((chain) => chain.id === chainId);
}

/** The chain with this id. Throws for ids other than 177, 133 and 11155111. */
export function getChain(chainId: number): Chain {
  const chain = findChain(chainId);
  if (!chain) {
    const known = SUPPORTED_CHAINS.map((c) => c.id).join(', ');
    throw new Error(`Unsupported chain id ${chainId} (Nod knows ${known})`);
  }
  return chain;
}

function explorerBase(chainId: number): string {
  const url = getChain(chainId).blockExplorers?.default.url;
  if (!url) throw new Error(`Chain ${chainId} has no block explorer`);
  return url.replace(/\/+$/, '');
}

/** Explorer page for a transaction. Throws for unknown chains. */
export function explorerTxUrl(chainId: number, hash: Hash | string): string {
  return `${explorerBase(chainId)}/tx/${hash}`;
}

/** Explorer page for an address. Throws for unknown chains. */
export function explorerAddressUrl(chainId: number, address: Address | string): string {
  return `${explorerBase(chainId)}/address/${address}`;
}
