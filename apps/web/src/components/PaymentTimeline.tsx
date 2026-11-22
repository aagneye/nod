import { SAFE_STEP, stepIndex, TIMELINE_STEPS } from '../lib/hspStatus';
import { Spinner } from './ui';

type StepState = 'done' | 'current' | 'pending' | 'failed';

function Marker({ state }: { state: StepState }) {
  if (state === 'done') {
    return (
      <span className="grid size-5 place-items-center rounded-full border border-[#14532d]/40 bg-mint text-[10px] font-extrabold text-[#14532d]">
        ✓
      </span>
    );
  }
  if (state === 'failed') {
    return (
      <span className="grid size-5 place-items-center rounded-full border border-[#8f2d15]/40 bg-[#fbdcd2] text-[10px] font-extrabold text-[#8f2d15]">
        ✕
      </span>
    );
  }
  if (state === 'current') return <Spinner className="size-4 border-[#171713]/25 border-t-[#171713]" />;
  return <span className="inline-block size-2.5 rounded-full border border-current opacity-60" />;
}

const CELL: Record<StepState, string> = {
  done: 'bg-panel',
  current: 'bg-acid text-[#171713]',
  pending: 'bg-panel text-faint',
  failed: 'bg-[#fbdcd2] text-[#8f2d15]',
};

export interface PaymentTimelineProps {
  /** Latest HSP status string (undefined before the first answer). */
  status?: string;
  outcome?: 'pending' | 'paid' | 'failed';
  /** Furthest step reached so far (statuses can be skipped between polls). */
  highest: number;
  /** Still polling: the next step shows a spinner. */
  live: boolean;
}

/** Submitted → verified → processing → included → safe → finalized, or failed at the step it reached. */
export function PaymentTimeline({ status, outcome, highest, live }: PaymentTimelineProps) {
  const reached = Math.max(highest, stepIndex(status));
  const failed = outcome === 'failed';
  // Paid at "safe": everything up to it is done; "finalized" may still follow.
  const doneThrough = failed ? reached : outcome === 'paid' ? Math.max(reached, SAFE_STEP) : reached;

  const stateOf = (i: number): StepState => {
    if (failed) return i <= reached ? 'done' : i === reached + 1 ? 'failed' : 'pending';
    if (i <= doneThrough) return 'done';
    if (i === doneThrough + 1 && live) return 'current';
    return 'pending';
  };

  return (
    <ol
      className="grid gap-[1.5px] border-[1.5px] border-ink bg-ink sm:grid-cols-3"
      aria-label="HSP payment progress"
    >
      {TIMELINE_STEPS.map((step, i) => {
        const state = stateOf(i);
        return (
          <li key={step.status} className={`p-3.5 ${CELL[state]}`} aria-current={state === 'current' ? 'step' : undefined}>
            <div className="flex items-center justify-between gap-2">
              <span className={`step-num ${state === 'current' || state === 'failed' ? '!text-current' : ''}`}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <Marker state={state} />
            </div>
            <p className="mt-3 text-[11px] font-extrabold tracking-[0.14em] uppercase">
              {state === 'failed' ? 'Failed' : step.label}
            </p>
            <p className={`mt-1 text-[11px] leading-snug ${state === 'pending' ? '' : 'opacity-80'}`}>
              {state === 'failed' ? 'HSP stopped the payment here' : step.text}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
