import { EXPLORER_TX_URL, type Network } from '@nod/protocol';

/** Chipnet by default; `VITE_NETWORK=mainnet` switches everything (chain, addresses, explorer). */
export const NETWORK: Network = import.meta.env.VITE_NETWORK === 'mainnet' ? 'mainnet' : 'chipnet';

export const EXPLORER_TX = EXPLORER_TX_URL[NETWORK];

/**
 * Widget Factory slide deck.
 * TODO(C9): replace with the team's own deck copy ("anyone with link can view").
 * Until then the banner links the official template so the link never 404s.
 */
export const SLIDES_URL =
  import.meta.env.VITE_SLIDES_URL ||
  'https://docs.google.com/presentation/d/1Yfuk9CJkf4U9M_WukcELhumWgj3Ak6345Ewy8hSp-Hk/edit';

export const REPO_URL = 'https://github.com/aagneye/nod';

/** Team CashTokens address for EMBER2026 community votes (submission gate). */
export const EMBER_ADDRESS = (import.meta.env.VITE_EMBER2026_ADDRESS ?? '').trim();

/** Origin serving the api/ functions; empty = same origin. */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');
