import { PUSD, type Amount } from '@nod/protocol';

/** Satoshis → BCH, trimming trailing zeros (1000 → "0.00001"). */
export const satsToBch = (sats: number): string =>
  (sats / 1e8).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');

export function formatAmount(amount: Amount): string {
  if ('sats' in amount) {
    return `${satsToBch(amount.sats)} BCH`;
  }
  const pusdCategory: string = PUSD.category;
  if (pusdCategory && amount.token.toLowerCase() === pusdCategory.toLowerCase()) {
    const units = BigInt(amount.units);
    const scale = 10n ** BigInt(PUSD.decimals);
    const whole = units / scale;
    const frac = (units % scale).toString().padStart(PUSD.decimals, '0').replace(/0+$/, '');
    return frac ? `${whole}.${frac} ${PUSD.symbol}` : `${whole} ${PUSD.symbol}`;
  }
  return `${amount.units} token units (${amount.token.slice(0, 12)}…)`;
}

/** Raw sats for the approval page's secondary line. */
export const satsLine = (amount: Amount): string | null =>
  'sats' in amount ? `${amount.sats.toLocaleString()} sats` : null;

/** Human label for a request expiry: "4m 12s", "2h 5m", "expired". */
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

export function formatExpiry(expiry: number): string {
  return new Date(expiry * 1000).toLocaleString();
}
