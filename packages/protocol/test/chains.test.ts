import { describe, expect, it } from 'vitest';
import { getAddress, isAddress } from 'viem';
import {
  HSK_MAINNET_TOKENS,
  SEPOLIA_TEST_USDC,
  SUPPORTED_CHAINS,
  explorerAddressUrl,
  explorerTxUrl,
  findChain,
  getChain,
  hskMainnet,
  hskTestnet,
  sepolia,
} from '../src/index.js';

const TX = `0x${'ab'.repeat(32)}` as const;

describe('chains', () => {
  it('defines HSK Chain mainnet and testnet per PROTOCOL §5', () => {
    expect(hskMainnet).toMatchObject({
      id: 177,
      nativeCurrency: { symbol: 'HSK', decimals: 18 },
      rpcUrls: { default: { http: ['https://mainnet.hsk.xyz'] } },
      blockExplorers: { default: { url: 'https://hsk.blockscout.com' } },
    });
    expect(hskTestnet).toMatchObject({
      id: 133,
      testnet: true,
      nativeCurrency: { symbol: 'HSK', decimals: 18 },
      rpcUrls: { default: { http: ['https://testnet.hsk.xyz'] } },
      blockExplorers: { default: { url: 'https://testnet-explorer.hskchain.net' } },
    });
    expect(sepolia.id).toBe(11155111);
    expect(SUPPORTED_CHAINS.map((c) => c.id)).toEqual([177, 133, 11155111]);
  });

  it('looks chains up by id', () => {
    expect(getChain(177)).toBe(hskMainnet);
    expect(getChain(133)).toBe(hskTestnet);
    expect(getChain(11155111)).toBe(sepolia);
    expect(findChain(1)).toBeUndefined();
    expect(() => getChain(1)).toThrow(/Unsupported chain id 1/);
  });

  it('builds explorer links', () => {
    expect(explorerTxUrl(133, TX)).toBe(`https://testnet-explorer.hskchain.net/tx/${TX}`);
    expect(explorerTxUrl(177, TX)).toBe(`https://hsk.blockscout.com/tx/${TX}`);
    expect(explorerTxUrl(11155111, TX)).toBe(`https://sepolia.etherscan.io/tx/${TX}`);
    expect(explorerAddressUrl(177, HSK_MAINNET_TOKENS.USDC)).toBe(
      `https://hsk.blockscout.com/address/${HSK_MAINNET_TOKENS.USDC}`,
    );
    expect(() => explorerTxUrl(8453, TX)).toThrow(/Unsupported/);
  });

  it('exports checksummed token addresses', () => {
    expect(HSK_MAINNET_TOKENS).toEqual({
      USDC: '0x054ed45810DbBAb8B27668922D110669c9D88D0a',
      USDT: '0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029',
    });
    expect(SEPOLIA_TEST_USDC).toBe('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238');
    for (const address of [HSK_MAINNET_TOKENS.USDC, HSK_MAINNET_TOKENS.USDT, SEPOLIA_TEST_USDC]) {
      expect(isAddress(address)).toBe(true);
      expect(getAddress(address)).toBe(address);
    }
  });
});
