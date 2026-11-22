import { NETWORK } from '../config';
import { satsToBch } from './format';

export const FAUCET_URL = 'https://tbch.googol.cash';

export interface FriendlyError {
  text: string;
  /** Extra line, e.g. "Needed ≈ 0.00002 BCH · available 0.00001 BCH". */
  detail?: string;
  /** Show the chipnet faucet link. */
  faucet?: boolean;
}

/** Turn wallet / tx-builder errors into something a judge can act on. */
export function friendlyError(e: unknown): FriendlyError {
  const msg = e instanceof Error ? e.message : String(e);
  if (/reject|denied|cancel/i.test(msg)) return { text: 'You rejected the signature in your wallet.' };
  if (/network error|failed to fetch|fetch failed|timed? ?out/i.test(msg)) {
    return { text: 'Could not reach a BCH server. Nothing was paid — try again.', detail: msg };
  }
  if (/not ready/i.test(msg)) return { text: 'Wallet still connecting — try again in a moment.' };

  if (/insufficient funds/i.test(msg) || /no spendable bch/i.test(msg)) {
    const m = /need about (\d+) sats[\s\S]*?have (\d+)/i.exec(msg);
    const detail = m
      ? `Needed ≈ ${satsToBch(Number(m[1]))} BCH (incl. fee) · available ${satsToBch(Number(m[2]))} BCH`
      : /no spendable bch/i.test(msg)
        ? 'Available: 0 BCH'
        : undefined;
    return {
      text: 'This wallet does not have enough BCH for this payment plus fee.',
      detail,
      faucet: NETWORK === 'chipnet',
    };
  }
  if (/insufficient tokens/i.test(msg)) {
    return { text: 'This wallet does not hold enough of the requested token.', detail: msg };
  }
  return { text: msg };
}
