/**
 * Receipt URLs: `/receipt/<flowId>?pr=<paymentRequestId>#<payload>`.
 * The terms ride in the fragment (never sent to a server), so the link alone lets anyone
 * re-check what was asked for against what HSP settled. Without a flow id, `/receipt#<payload>`
 * looks up the receipt anchored on HSK Chain for those terms.
 */
export function receiptPath(flowId: string | undefined, paymentRequestId: string | undefined, payload?: string): string {
  const path = flowId ? `/receipt/${encodeURIComponent(flowId)}` : '/receipt';
  const query = flowId && paymentRequestId ? `?${new URLSearchParams({ pr: paymentRequestId }).toString()}` : '';
  return `${path}${query}${payload ? `#${payload}` : ''}`;
}

/** The payload part of a location hash ("#abc" → "abc"). */
export const payloadFromHash = (hash: string): string => (hash.startsWith('#') ? hash.slice(1) : hash);

/** In-app path for a request link from any origin: `<anything>/r#<payload>` → `/r#<payload>`. */
export function requestPathFromLink(link: string): string | null {
  const hash = link.indexOf('#');
  if (hash < 0 || hash === link.length - 1) return null;
  return `/r${link.slice(hash)}`;
}
