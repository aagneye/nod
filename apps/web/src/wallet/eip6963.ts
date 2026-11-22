/**
 * EIP-6963 wallet discovery: every installed wallet (OKX Wallet, MetaMask, Rabby…) announces itself
 * with a name, icon and provider, so several can coexist without fighting over window.ethereum.
 * Falls back to window.ethereum for wallets that do not announce.
 */
import { useSyncExternalStore } from 'react';
import type { EIP1193Provider } from './eip1193';

export interface WalletInfo {
  uuid: string;
  name: string;
  /** Data URI supplied by the wallet; render it with <img>, never as HTML. */
  icon: string;
  /** Reverse-DNS id, e.g. "com.okex.wallet", "io.metamask". */
  rdns: string;
}

export interface WalletOption {
  info: WalletInfo;
  provider: EIP1193Provider;
}

interface AnnounceDetail {
  info?: Partial<WalletInfo>;
  provider?: EIP1193Provider;
}

type InjectedProvider = EIP1193Provider & {
  isMetaMask?: boolean;
  isOkxWallet?: boolean;
  isOKExWallet?: boolean;
  isRabby?: boolean;
  isCoinbaseWallet?: boolean;
  isBraveWallet?: boolean;
};

export const INJECTED_RDNS = 'injected';

const announced = new Map<string, WalletOption>();
const listeners = new Set<() => void>();
const EMPTY: readonly WalletOption[] = [];
let snapshot: readonly WalletOption[] = EMPTY;
let started = false;

/** Several flags are set by many wallets for compatibility (isMetaMask especially): check it last. */
function injectedName(provider: InjectedProvider): string {
  if (provider.isOkxWallet || provider.isOKExWallet) return 'OKX Wallet';
  if (provider.isRabby) return 'Rabby';
  if (provider.isCoinbaseWallet) return 'Coinbase Wallet';
  if (provider.isBraveWallet) return 'Brave Wallet';
  if (provider.isMetaMask) return 'MetaMask';
  return 'Browser wallet';
}

function injectedFallback(): WalletOption | null {
  const w = window as unknown as { ethereum?: InjectedProvider; okxwallet?: InjectedProvider };
  const provider = w.ethereum ?? w.okxwallet;
  if (!provider || typeof provider.request !== 'function') return null;
  return { info: { uuid: INJECTED_RDNS, name: injectedName(provider), icon: '', rdns: INJECTED_RDNS }, provider };
}

function rebuild(): void {
  // One entry per wallet: some announce again on every requestProvider.
  const byRdns = new Map<string, WalletOption>();
  for (const option of announced.values()) {
    if (!byRdns.has(option.info.rdns)) byRdns.set(option.info.rdns, option);
  }
  let next: WalletOption[] = [...byRdns.values()];
  if (next.length === 0) {
    const fallback = injectedFallback();
    if (fallback) next = [fallback];
  }
  const same =
    next.length === snapshot.length &&
    next.every((option, i) => option.provider === snapshot[i]?.provider && option.info.uuid === snapshot[i]?.info.uuid);
  if (same) return;
  snapshot = next.length === 0 ? EMPTY : next;
  for (const listener of listeners) listener();
}

function onAnnounce(event: Event): void {
  const detail = (event as CustomEvent<AnnounceDetail>).detail;
  const info = detail?.info;
  const provider = detail?.provider;
  if (!info || typeof info.uuid !== 'string' || !provider || typeof provider.request !== 'function') return;
  announced.set(info.uuid, {
    info: {
      uuid: info.uuid,
      name: typeof info.name === 'string' && info.name.trim() ? info.name.trim() : 'Wallet',
      icon: typeof info.icon === 'string' && info.icon.startsWith('data:image/') ? info.icon : '',
      rdns: typeof info.rdns === 'string' && info.rdns ? info.rdns : info.uuid,
    },
    provider,
  });
  rebuild();
}

function start(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('eip6963:announceProvider', onAnnounce);
  requestWallets();
  // Wallets that inject window.ethereum late and never announce.
  window.addEventListener('load', rebuild, { once: true });
  setTimeout(rebuild, 800);
}

/** Ask installed wallets to announce themselves (again). */
export function requestWallets(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  rebuild();
}

/** Subscribing starts discovery (kept out of render so getWallets stays pure). */
export function subscribeWallets(listener: () => void): () => void {
  listeners.add(listener);
  start();
  return () => listeners.delete(listener);
}

/** Wallets detected so far. */
export function getWallets(): readonly WalletOption[] {
  return snapshot;
}

/** Detected wallets, live. */
export function useWallets(): readonly WalletOption[] {
  return useSyncExternalStore(subscribeWallets, getWallets, () => EMPTY);
}
