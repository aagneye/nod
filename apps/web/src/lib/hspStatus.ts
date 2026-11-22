/** HSP payment states in order (PROTOCOL §2, query_payment). */
export const TIMELINE_STEPS = [
  { status: 'payment-submitted', label: 'Submitted', text: 'HSP has your signed authorization' },
  { status: 'payment-verified', label: 'Verified', text: 'HSP checked the signature and the order' },
  { status: 'payment-processing', label: 'Processing', text: "HSP's Gateway is sending the transfer" },
  { status: 'payment-included', label: 'Included', text: 'The transfer is in a block' },
  { status: 'payment-safe', label: 'Safe', text: 'Enough confirmations to count as paid' },
  { status: 'payment-finalized', label: 'Finalized', text: 'The block is final' },
] as const;

export const SAFE_STEP = 4;
export const FINALIZED_STEP = 5;

/** "PAYMENT_SAFE", "payment safe", "safe" → "payment-safe". */
export function normalizeStatus(status: string | undefined): string {
  const s = (status ?? '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  return s && !s.startsWith('payment-') ? `payment-${s}` : s;
}

/** Position of a status in the timeline, -1 when it is not one of the six steps. */
export const stepIndex = (status: string | undefined): number =>
  TIMELINE_STEPS.findIndex((step) => step.status === normalizeStatus(status));
