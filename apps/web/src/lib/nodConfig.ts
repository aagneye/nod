import { useEffect, useSyncExternalStore } from 'react';
import { getConfig, type NodConfig } from './api';
import { errorMessage } from './errors';

/**
 * GET /api/config, fetched once and shared by the header, the simulation banner, the home
 * status panel and the payment pages. `refreshConfig()` re-reads it (the old value stays visible).
 */
export interface ConfigState {
  config: NodConfig | null;
  error: string | null;
  loading: boolean;
  /** Date.now() of the last successful read. */
  fetchedAt: number | null;
}

let state: ConfigState = { config: null, error: null, loading: false, fetchedAt: null };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

const setState = (patch: Partial<ConfigState>): void => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};

export function refreshConfig(): Promise<void> {
  if (inflight) return inflight;
  setState({ loading: true });
  inflight = getConfig()
    .then(
      (config) => setState({ config, error: null, loading: false, fetchedAt: Date.now() }),
      (error: unknown) => setState({ error: errorMessage(error), loading: false }),
    )
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): ConfigState => state;

export function useNodConfig(): ConfigState {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    if (!state.config && !state.error && !inflight) void refreshConfig();
  }, []);
  return snapshot;
}

/** The chain HSP pays on, falling back to the receipts chain (HSK Chain) before the option is known. */
export const paymentChainId = (config: NodConfig | null): number | undefined =>
  config?.hsp?.option?.chainId ?? config?.receipts?.chainId;
