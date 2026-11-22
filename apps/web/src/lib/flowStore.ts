/**
 * The payer of each HSP flow this tab started, so the receipt page can pass it to /api/pay/settle
 * when HSP's status does not include it. Session storage only; the receipt link works without it.
 */
const key = (flowId: string): string => `nod:payer:${flowId}`;

export function savePayer(flowId: string, payer: string): void {
  try {
    sessionStorage.setItem(key(flowId), payer);
  } catch {
    /* storage blocked: settle relies on HSP's status for the payer */
  }
}

export function loadPayer(flowId: string): string | undefined {
  try {
    return sessionStorage.getItem(key(flowId)) ?? undefined;
  } catch {
    return undefined;
  }
}
