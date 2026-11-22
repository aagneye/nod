import { explorerAddressUrl, explorerTxUrl, findChain } from '@nod/protocol';

export const HSK_MAINNET_ID = 177;
export const HSK_TESTNET_ID = 133;
export const SEPOLIA_ID = 11155111;

/** Short uppercase-friendly label: "HSK Mainnet", "HSK Testnet", "Sepolia", "Chain 1". */
export function chainLabel(chainId: number | null | undefined): string {
  switch (chainId) {
    case HSK_MAINNET_ID:
      return 'HSK Mainnet';
    case HSK_TESTNET_ID:
      return 'HSK Testnet';
    case SEPOLIA_ID:
      return 'Sepolia';
    default:
      return chainId ? `Chain ${chainId}` : 'Unknown network';
  }
}

/** The chain's full name when Nod knows it ("HashKey Chain Testnet"), else the short label. */
export function chainName(chainId: number | null | undefined): string {
  return (chainId ? findChain(chainId)?.name : undefined) ?? chainLabel(chainId);
}

/** Known test networks (HSK testnet, Sepolia): tokens there have no value. */
export function isTestnet(chainId: number | null | undefined): boolean {
  return chainId === HSK_TESTNET_ID || chainId === SEPOLIA_ID;
}

/** Chain id from a number, decimal string or 0x-hex string; undefined when unreadable. */
export function parseChainId(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  if (typeof value === 'bigint') return value > 0n ? Number(value) : undefined;
  if (typeof value === 'string' && /^(0x[0-9a-f]+|\d+)$/i.test(value.trim())) {
    const id = Number(value.trim());
    return Number.isSafeInteger(id) && id > 0 ? id : undefined;
  }
  return undefined;
}

const trimBase = (url: string): string => url.replace(/\/+$/, '');

/** Explorer page for a transaction, or undefined when the chain is unknown. */
export function txUrl(chainId: number | null | undefined, hash: string | null | undefined): string | undefined {
  if (!chainId || !hash) return undefined;
  try {
    return explorerTxUrl(chainId, hash);
  } catch {
    return undefined;
  }
}

/**
 * Explorer page for an address. `explorer` (e.g. from /api/config) wins when given: a base URL, or any
 * page on the explorer (its origin and path up to /address/ are kept). Undefined when neither it nor
 * the chain is known.
 */
export function addressUrl(
  chainId: number | null | undefined,
  address: string | null | undefined,
  explorer?: string | null,
): string | undefined {
  if (!address) return undefined;
  if (explorer && /^https?:\/\//.test(explorer)) {
    const cut = explorer.search(/\/(address|tx)\//);
    return `${trimBase(cut >= 0 ? explorer.slice(0, cut) : explorer)}/address/${address}`;
  }
  if (!chainId) return undefined;
  try {
    return explorerAddressUrl(chainId, address);
  } catch {
    return undefined;
  }
}
