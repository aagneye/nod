import { decodeLink, encodeLink, type SignedNodRequest } from '@nod/protocol';

/**
 * Shareable receipt URL: `/tx/<txid>#<payload>[.<payload>…]`. Payloads are
 * base64url (never contain '.'), so a batch joins them with '.'. The fragment
 * never reaches a server, and a fresh browser can verify the receipt from it alone.
 */
export const receiptPath = (txid: string, signed: SignedNodRequest[]): string =>
  `/tx/${txid}${signed.length > 0 ? `#${signed.map(encodeLink).join('.')}` : ''}`;

/** Requests carried in the receipt URL fragment; null if absent or unreadable. */
export function requestsFromHash(hash: string): { signed: SignedNodRequest; valid: boolean }[] | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  try {
    const parts = raw.split('.').filter(Boolean);
    if (parts.length === 0) return null;
    return parts.map((p) => {
      const { signed, valid } = decodeLink(p);
      return { signed, valid };
    });
  } catch {
    return null;
  }
}
