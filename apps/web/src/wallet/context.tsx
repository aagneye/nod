import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Address, Hex } from 'viem';
import type { TypedDataPayload } from '../lib/api';
import { parseChainId } from '../lib/chains';
import { friendlyError, noWalletError, WalletError, type FriendlyError } from '../lib/errors';
import {
  getAccounts,
  getChainId,
  requestAccounts,
  signTypedDataV4,
  switchChain as switchProviderChain,
  toAddress,
  typedDataChainId,
} from './eip1193';
import { getWallets, requestWallets, useWallets, type WalletOption } from './eip6963';

export type WalletStatus = 'idle' | 'connecting' | 'connected';

interface Connection {
  option: WalletOption;
  /** The account exactly as the wallet returned it (used for signing). */
  account: string;
  /** Checksummed, for display and API calls. */
  address: Address;
  chainId: number | null;
}

export interface WalletContextValue {
  /** Wallets detected through EIP-6963 (or window.ethereum). */
  wallets: readonly WalletOption[];
  status: WalletStatus;
  wallet: WalletOption | null;
  address: Address | null;
  chainId: number | null;
  /** The wallet a connection is in progress with. */
  connectingTo: WalletOption | null;
  pickerOpen: boolean;
  pickerError: FriendlyError | null;
  openPicker(): void;
  closePicker(): void;
  /** eth_requestAccounts on this wallet. */
  connect(option: WalletOption): Promise<Address>;
  /** The connected address; connects first (straight away for one wallet, through the picker for several). */
  ensureConnected(): Promise<Address>;
  disconnect(): void;
  switchChain(chainId: number): Promise<void>;
  /** Switch to domain.chainId, then eth_signTypedData_v4 with the typed data unchanged. */
  signTypedData(typedData: TypedDataPayload): Promise<Hex>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

const STORAGE_KEY = 'nod-wallet';

const storeChoice = (rdns: string): void => {
  try {
    localStorage.setItem(STORAGE_KEY, rdns);
  } catch {
    /* storage blocked: no silent reconnect next time */
  }
};
const clearChoice = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
};
const storedChoice = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const notConnected = (): WalletError => new WalletError('no_account', 'Connect your wallet first.');

/**
 * One wallet connection for the whole app (header button, picker and payment page share it).
 * Stores the last wallet choice and reconnects silently with eth_accounts on reload.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const wallets = useWallets();
  const [conn, setConn] = useState<Connection | null>(null);
  const [connectingTo, setConnectingTo] = useState<WalletOption | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerError, setPickerError] = useState<FriendlyError | null>(null);

  // Long async flows (sign after a re-quote) must see the live connection, not a stale render's.
  const connRef = useRef<Connection | null>(null);
  const pendingRef = useRef<{ resolve: (address: Address) => void; reject: (error: unknown) => void } | null>(null);
  const triedReconnect = useRef(false);

  const commit = useCallback((next: Connection | null) => {
    connRef.current = next;
    setConn(next);
  }, []);

  const patch = useCallback(
    (update: Partial<Connection>) => {
      if (connRef.current) commit({ ...connRef.current, ...update });
    },
    [commit],
  );

  const connect = useCallback(
    async (option: WalletOption): Promise<Address> => {
      setConnectingTo(option);
      setPickerError(null);
      try {
        const [account] = await requestAccounts(option.provider);
        if (!account) {
          throw new WalletError('no_account', 'Your wallet did not share an account. Unlock it, then try again.');
        }
        const chainId = (await getChainId(option.provider).catch(() => undefined)) ?? null;
        const next: Connection = { option, account, address: toAddress(account), chainId };
        commit(next);
        storeChoice(option.info.rdns);
        setPickerOpen(false);
        pendingRef.current?.resolve(next.address);
        pendingRef.current = null;
        return next.address;
      } catch (error) {
        setPickerError(friendlyError(error, 'connect'));
        throw error;
      } finally {
        setConnectingTo(null);
      }
    },
    [commit],
  );

  const openPicker = useCallback(() => {
    setPickerError(null);
    requestWallets();
    setPickerOpen(true);
  }, []);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    setPickerError(null);
    pendingRef.current?.reject(new WalletError('closed', 'No wallet connected. Pick a wallet to continue.'));
    pendingRef.current = null;
  }, []);

  const ensureConnected = useCallback(async (): Promise<Address> => {
    if (connRef.current) return connRef.current.address;
    requestWallets();
    const list = getWallets();
    if (list.length === 0) throw noWalletError();
    if (list.length === 1) return connect(list[0]!);
    pendingRef.current?.reject(new WalletError('closed', 'Pick a wallet to continue.'));
    return new Promise<Address>((resolve, reject) => {
      pendingRef.current = { resolve, reject };
      setPickerError(null);
      setPickerOpen(true);
    });
  }, [connect]);

  const disconnect = useCallback(() => {
    commit(null);
    clearChoice();
  }, [commit]);

  const switchChain = useCallback(
    async (chainId: number) => {
      const current = connRef.current;
      if (!current) throw notConnected();
      await switchProviderChain(current.option.provider, chainId);
      patch({ chainId });
    },
    [patch],
  );

  const signTypedData = useCallback(
    async (typedData: TypedDataPayload): Promise<Hex> => {
      const current = connRef.current;
      if (!current) throw notConnected();
      const chainId = typedDataChainId(typedData);
      if (chainId !== undefined) {
        await switchProviderChain(current.option.provider, chainId);
        patch({ chainId });
      }
      const live = connRef.current;
      if (!live) throw notConnected();
      return signTypedDataV4(live.option.provider, live.account, typedData);
    },
    [patch],
  );

  // Follow account and network changes made in the wallet itself.
  const provider = conn?.option.provider;
  useEffect(() => {
    if (!provider?.on) return;
    const onAccounts = (accounts: unknown) => {
      const list = Array.isArray(accounts) ? accounts.filter((a): a is string => typeof a === 'string') : [];
      const account = list[0];
      if (!account) {
        commit(null);
        clearChoice();
        return;
      }
      try {
        patch({ account, address: toAddress(account) });
      } catch {
        /* not an address: ignore */
      }
    };
    const onChain = (chainId: unknown) => patch({ chainId: parseChainId(chainId) ?? null });
    provider.on('accountsChanged', onAccounts);
    provider.on('chainChanged', onChain);
    return () => {
      provider.removeListener?.('accountsChanged', onAccounts);
      provider.removeListener?.('chainChanged', onChain);
    };
  }, [provider, commit, patch]);

  // Silent reconnect to the last wallet once it has announced itself.
  useEffect(() => {
    if (triedReconnect.current || connRef.current) return;
    const rdns = storedChoice();
    if (!rdns) {
      triedReconnect.current = true;
      return;
    }
    const option = wallets.find((w) => w.info.rdns === rdns);
    if (!option) return;
    triedReconnect.current = true;
    void (async () => {
      try {
        const [account] = await getAccounts(option.provider);
        if (!account || connRef.current) return;
        const chainId = (await getChainId(option.provider).catch(() => undefined)) ?? null;
        commit({ option, account, address: toAddress(account), chainId });
      } catch {
        /* stay disconnected */
      }
    })();
  }, [wallets, commit]);

  const value = useMemo<WalletContextValue>(
    () => ({
      wallets,
      status: conn ? 'connected' : connectingTo ? 'connecting' : 'idle',
      wallet: conn?.option ?? null,
      address: conn?.address ?? null,
      chainId: conn?.chainId ?? null,
      connectingTo,
      pickerOpen,
      pickerError,
      openPicker,
      closePicker,
      connect,
      ensureConnected,
      disconnect,
      switchChain,
      signTypedData,
    }),
    [
      wallets,
      conn,
      connectingTo,
      pickerOpen,
      pickerError,
      openPicker,
      closePicker,
      connect,
      ensureConnected,
      disconnect,
      switchChain,
      signTypedData,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used inside <WalletProvider>');
  return ctx;
}
