import type { Network } from './types.js';

/** Protocol version written into every request and memo. */
export const NOD_VERSION = 1;

/** OP_RETURN prefix: ASCII "NOD". */
export const MEMO_PREFIX_HEX = '4e4f44';

/** Memo kinds after the prefix. */
export const MEMO_KIND_SINGLE = 0x01;
export const MEMO_KIND_BATCH = 0x02;

/** Most requests one approval may pay. */
export const MAX_BATCH = 50;

/** Smallest output most nodes relay. */
export const DUST_SATS = 546n;

/** Satoshis that carry a token output. */
export const TOKEN_OUTPUT_SATS = 1000n;

/** Fee rate used by the transaction builder. */
export const FEE_SATS_PER_BYTE = 1n;

export const MAX_PURPOSE_LENGTH = 140;

/**
 * Public Fulcrum servers (Electrum Cash protocol over secure WebSocket, port 50004).
 * All four answered a live check on 2026-11-19.
 */
export const ELECTRUM_SERVERS: Record<Network, string[]> = {
  mainnet: ['bch.imaginary.cash', 'bch.loping.net'],
  chipnet: ['chipnet.imaginary.cash', 'chipnet.bch.ninja'],
};

export const CASHADDR_PREFIX: Record<Network, 'bitcoincash' | 'bchtest'> = {
  mainnet: 'bitcoincash',
  chipnet: 'bchtest',
};

/** TODO(Person B): open one real txid on each before the demo; swap the chipnet one if it fails. */
export const EXPLORER_TX_URL: Record<Network, string> = {
  mainnet: 'https://explorer.bch.ninja/tx/',
  chipnet: 'https://chipnet.chaingraph.cash/tx/',
};

/**
 * ParyonUSD (PUSD) token category on mainnet.
 * TODO(day 1): confirm the category id and decimals with the ParyonUSD team before using it.
 */
export const PUSD = {
  category: '',
  decimals: 2,
  symbol: 'PUSD',
} as const;
