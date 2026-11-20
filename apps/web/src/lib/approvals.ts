import type { SignedNodRequest } from '@nod/protocol';

/**
 * Approved requests are remembered per txid so the receipt page can verify
 * "request matches payment" even after a reload. Session storage only — the
 * chain remains the source of truth; this is just the request we paid.
 */
const key = (txid: string): string => `nod:approved:${txid}`;

export function saveApproved(txid: string, signed: SignedNodRequest[]): void {
  try {
    sessionStorage.setItem(key(txid), JSON.stringify(signed));
  } catch {
    /* storage full or blocked — verification then falls back to memo display */
  }
}

export function loadApproved(txid: string): SignedNodRequest[] | null {
  try {
    const raw = sessionStorage.getItem(key(txid));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed as SignedNodRequest[];
  } catch {
    return null;
  }
}
