import { formatUnits } from 'viem';

const groupThousands = (whole: string): string => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** "12.5" → "$12.50". Exact string handling, no floats; unreadable input comes back with a $ prefix. */
export function formatUsd(amountUsd: string | number): string {
  const text = String(amountUsd).trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return `$${text}`;
  const whole = match[1]!.replace(/^0+(?=\d)/, '');
  const fraction = match[2] ?? '';
  // Pad to cents; never round away precision the server sent.
  const cents = fraction.length <= 2 ? fraction.padEnd(2, '0') : fraction;
  return `$${groupThousands(whole)}.${cents}`;
}

/** Token base units → "0.1" (exact, via viem formatUnits); undefined when `raw` is not an integer. */
export function tokenAmount(raw: bigint | string | number, decimals: number): string | undefined {
  let value: bigint;
  try {
    value = typeof raw === 'bigint' ? raw : BigInt(raw);
  } catch {
    return undefined;
  }
  if (!Number.isInteger(decimals) || decimals < 0) return undefined;
  const [whole = '0', fraction] = formatUnits(value, decimals).split('.');
  return fraction ? `${groupThousands(whole)}.${fraction}` : groupThousands(whole);
}

/** Token base units → "0.1 USDC"; falls back to the raw value when it cannot be read. */
export function formatToken(raw: bigint | string | number, decimals: number, coin?: string): string {
  const amount = tokenAmount(raw, decimals);
  if (amount === undefined) return `${String(raw)} base units${coin ? ` of ${coin}` : ''}`;
  return coin ? `${amount} ${coin}` : amount;
}

/** 0x1234…cdef for compact display. */
export function shortAddress(address: string, keep = 4): string {
  if (address.length <= keep * 2 + 3) return address;
  return `${address.slice(0, 2 + keep)}…${address.slice(-keep)}`;
}

/** 0x12345678…90abcdef for transaction hashes. */
export const shortHash = (hash: string, keep = 8): string => shortAddress(hash, keep);

/** Human countdown: "4m 12s", "2h 5m", "expired". */
export function expiryLabel(expiry: number, nowSeconds = Date.now() / 1000): string {
  const left = expiry - nowSeconds;
  if (left <= 0) return 'expired';
  const s = Math.floor(left);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d}d ${h % 24}h`;
  if (h >= 1) return `${h}h ${m % 60}m`;
  if (m >= 1) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

/** Local date and time for unix seconds. */
export function formatDateTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString();
}

/**
 * Unix seconds from unix seconds, milliseconds, a numeric string or an ISO date.
 * Undefined when the value cannot be read as a time.
 */
export function toUnixSeconds(value: unknown): number | undefined {
  if (typeof value === 'bigint') return toUnixSeconds(Number(value));
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return undefined;
    return Math.floor(value > 1e12 ? value / 1000 : value);
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return undefined;
    if (/^\d+(\.\d+)?$/.test(text)) return toUnixSeconds(Number(text));
    const ms = Date.parse(text);
    return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
  }
  return undefined;
}
