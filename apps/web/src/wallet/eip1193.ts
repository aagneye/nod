/**
 * Thin EIP-1193 helpers: accounts, chain switching (with wallet_addEthereumChain fallback from the
 * protocol's chain definitions) and eth_signTypedData_v4 over HSP's typed data, unchanged.
 */
import { findChain } from '@nod/protocol';
import { getAddress, isAddress, numberToHex, type Address, type Hex } from 'viem';
import type { TypedDataPayload } from '../lib/api';
import { chainLabel, chainName, parseChainId } from '../lib/chains';
import { errorMessage, rpcErrorCode, WalletError } from '../lib/errors';

export interface EIP1193Provider {
  request(args: { method: string; params?: readonly unknown[] | Record<string, unknown> }): Promise<unknown>;
  on?(event: string, listener: (...args: never[]) => void): unknown;
  removeListener?(event: string, listener: (...args: never[]) => void): unknown;
}

const accountList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((a): a is string => typeof a === 'string' && isAddress(a, { strict: false })) : [];

/** eth_requestAccounts: prompts the user to connect. */
export async function requestAccounts(provider: EIP1193Provider): Promise<string[]> {
  return accountList(await provider.request({ method: 'eth_requestAccounts' }));
}

/** eth_accounts: the accounts already shared with this site, without a prompt. */
export async function getAccounts(provider: EIP1193Provider): Promise<string[]> {
  return accountList(await provider.request({ method: 'eth_accounts' }));
}

export async function getChainId(provider: EIP1193Provider): Promise<number | undefined> {
  return parseChainId(await provider.request({ method: 'eth_chainId' }));
}

/** Checksummed form of an account string from the wallet. */
export const toAddress = (account: string): Address => getAddress(account);

function isUnknownChainError(error: unknown): boolean {
  if (rpcErrorCode(error) === 4902) return true;
  return /unrecognized chain|unknown chain|chain.*(not (been )?added|not (supported|found|configured))|try adding the chain|add(ing)? (the )?chain first/i.test(
    errorMessage(error),
  );
}

function addChainParams(chainId: number): Record<string, unknown> {
  const chain = findChain(chainId);
  if (!chain) {
    throw new WalletError(
      'unsupported_chain',
      `Your wallet does not know ${chainLabel(chainId)}, and Nod has no settings to add it. Add the network in your wallet, then try again.`,
    );
  }
  const params: Record<string, unknown> = {
    chainId: numberToHex(chainId),
    chainName: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: [...chain.rpcUrls.default.http],
  };
  const explorer = chain.blockExplorers?.default.url;
  if (explorer) params.blockExplorerUrls = [explorer];
  return params;
}

/**
 * Put the wallet on `chainId`: wallet_switchEthereumChain, and when the wallet does not know the chain,
 * wallet_addEthereumChain with Nod's definition (HSK Chain mainnet 177, testnet 133, Sepolia). Throws a
 * WalletError('wrong_chain') when the wallet still reports another chain afterwards.
 */
export async function switchChain(provider: EIP1193Provider, chainId: number): Promise<void> {
  const current = await getChainId(provider).catch(() => undefined);
  if (current === chainId) return;
  const hexId = numberToHex(chainId);
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
  } catch (error) {
    if (!isUnknownChainError(error)) throw error;
    await provider.request({ method: 'wallet_addEthereumChain', params: [addChainParams(chainId)] });
    // Most wallets switch right after adding; some only add.
    if ((await getChainId(provider).catch(() => undefined)) !== chainId) {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
    }
  }
  const after = await getChainId(provider).catch(() => undefined);
  if (after !== undefined && after !== chainId) {
    throw new WalletError(
      'wrong_chain',
      `Your wallet is still on ${chainLabel(after)}. Switch it to ${chainName(chainId)} (chain ${chainId}) and try again.`,
    );
  }
}

/** EIP712Domain fields in canonical order, with their types. */
const DOMAIN_FIELDS = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
  { name: 'salt', type: 'bytes32' },
] as const;

/**
 * eth_signTypedData_v4 needs `types.EIP712Domain`. When HSP's payload leaves it out, derive it from the
 * keys present in the domain. Domain, primaryType and message are passed through untouched.
 */
export function withDomainType(typedData: TypedDataPayload): TypedDataPayload {
  if (typedData.types.EIP712Domain) return typedData;
  const domainType = DOMAIN_FIELDS.filter(
    ({ name }) => typedData.domain[name] !== undefined && typedData.domain[name] !== null,
  ).map(({ name, type }) => ({ name, type }));
  return { ...typedData, types: { EIP712Domain: domainType, ...typedData.types } };
}

/** The chain the typed data is bound to (domain.chainId), if any. */
export const typedDataChainId = (typedData: TypedDataPayload): number | undefined =>
  parseChainId(typedData.domain.chainId);

/** Sign HSP's EIP-712 authorization exactly as returned (plus EIP712Domain when missing). */
export async function signTypedDataV4(
  provider: EIP1193Provider,
  account: string,
  typedData: TypedDataPayload,
): Promise<Hex> {
  const payload = JSON.stringify(withDomainType(typedData), (_key, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
  const signature = await provider.request({ method: 'eth_signTypedData_v4', params: [account, payload] });
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130,}$/.test(signature)) {
    throw new WalletError('bad_signature', 'Your wallet returned something that is not a signature. Please try again.');
  }
  return signature as Hex;
}
