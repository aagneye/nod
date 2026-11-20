import { NodElectrum } from '@nod/protocol';
import { NETWORK } from '../config';

/**
 * One Electrum connection for the whole app. Connects lazily; safe to call
 * from any page. The servers are the public Fulcrum WSS endpoints checked in
 * constants.ts.
 */
export const chain = new NodElectrum(NETWORK);

/** Observable connection state for the header's status pill. */
export type ChainStatus = 'idle' | 'connecting' | 'live' | 'error';

let status: ChainStatus = 'idle';
const listeners = new Set<(s: ChainStatus) => void>();

const setStatus = (next: ChainStatus): void => {
  if (status === next) return;
  status = next;
  for (const listener of listeners) listener(next);
};

export const getChainStatus = (): ChainStatus => status;

/** Subscribe to connection changes; returns an unsubscribe function. */
export function onChainStatus(listener: (s: ChainStatus) => void): () => void {
  listeners.add(listener);
  listener(status);
  return () => listeners.delete(listener);
}

let connecting: Promise<void> | null = null;

export function getChain(): Promise<NodElectrum> {
  if (!connecting) {
    setStatus('connecting');
    connecting = chain.connect().then(
      () => {
        setStatus('live');
      },
      (e: unknown) => {
        connecting = null;
        setStatus('error');
        throw e;
      },
    );
  }
  return connecting.then(() => chain);
}

export function networkLabel(): string {
  return NETWORK === 'mainnet' ? 'BCH MAINNET' : 'CHIPNET';
}
