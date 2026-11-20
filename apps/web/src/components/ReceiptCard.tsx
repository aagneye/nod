import { Link } from 'react-router-dom';
import type { ReceiptCheck, SignedNodRequest } from '@nod/protocol';
import { EXPLORER_TX } from '../config';
import { formatAmount } from '../lib/format';
import { shortAddress } from '../lib/address';
import { Badge, Card } from './ui';

export interface VerifiedEntry {
  signed: SignedNodRequest;
  check: ReceiptCheck;
}

function TxRow({ txid }: { txid: string }) {
  return (
    <div className="border border-line bg-soft p-4">
      <span className="label">Transaction</span>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <code className="break-all text-xs text-muted">{txid}</code>
        <a
          href={`${EXPLORER_TX}${txid}`}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-[10px] font-bold tracking-[0.14em] text-accent uppercase underline-offset-4 hover:underline"
        >
          Explorer ↗
        </a>
      </div>
    </div>
  );
}

/** Result view for /tx/:txid — verified against the paid request(s), or what the chain alone shows. */
export function ReceiptCard({ txid, entries }: { txid: string; entries: VerifiedEntry[] }) {
  const allOk = entries.length > 0 && entries.every((e) => e.check.ok);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="eyebrow">Receipt</span>
          <h2 className="display mt-4 text-3xl sm:text-4xl">
            {allOk ? 'Request matches payment' : entries.some((e) => e.check.ok) ? 'Partially verified' : 'Verification failed'}
          </h2>
        </div>
        <Badge tone={allOk ? 'ok' : 'bad'} dot>
          {allOk ? 'Verified on-chain' : 'Check reasons'}
        </Badge>
      </div>

      <div className="mt-6">
        <TxRow txid={txid} />
      </div>

      <ul className="mt-6">
        {entries.map(({ signed, check }) => (
          <li key={signed.req.id} className="border border-line p-4 not-last:mb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold tracking-[0.1em] uppercase">{signed.req.agentName}</span>
              <span className="display text-xl">{formatAmount(signed.req.amount)}</span>
            </div>
            <p className="mt-1.5 text-sm text-muted">
              {signed.req.purpose} → {shortAddress(signed.req.vendor, 10)}
            </p>
            {check.ok ? (
              <p className="mt-3 text-[10px] font-bold tracking-[0.14em] text-accent uppercase">
                ✓ Paid exactly as requested · memo commits this request
              </p>
            ) : (
              <ul className="mt-3 space-y-1">
                {check.reasons.map((reason) => (
                  <li key={reason} className="text-xs text-danger">
                    ✗ {reason}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <div className="rule mt-6 flex gap-6 pt-4 text-[10px]">
        <Link
          to="/"
          className="font-bold tracking-[0.14em] text-muted uppercase underline-offset-4 hover:text-ink hover:underline"
        >
          ← Home
        </Link>
        <Link
          to="/batch"
          className="font-bold tracking-[0.14em] text-muted uppercase underline-offset-4 hover:text-ink hover:underline"
        >
          Pay a batch
        </Link>
      </div>
    </Card>
  );
}

/** Shown when the receipt page has no stored request for this txid (fresh browser / shared link). */
export function ChainOnlyReceipt({
  txid,
  memos,
  noMemo,
}: {
  txid: string;
  memos?: { kind: string; hash: string }[];
  noMemo?: boolean;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="eyebrow">Receipt</span>
          <h2 className="display mt-4 text-3xl">Transaction found on-chain</h2>
        </div>
        <Badge tone={noMemo ? 'warn' : 'ok'} dot>
          {noMemo ? 'No NOD memo' : 'NOD memo present'}
        </Badge>
      </div>

      <div className="mt-6">
        <TxRow txid={txid} />
      </div>

      {memos && memos.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {memos.map((memo) => (
            <li key={memo.hash} className="border border-line p-4">
              <span className="label">NOD {memo.kind} memo</span>
              <code className="mt-1.5 block break-all text-xs text-muted">{memo.hash}</code>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-4 text-xs leading-relaxed text-faint">
        Open this receipt from the approval page it came from to verify it against the agent's request.
      </p>

      <div className="rule mt-6 pt-4 text-[10px]">
        <Link
          to="/"
          className="font-bold tracking-[0.14em] text-muted uppercase underline-offset-4 hover:text-ink hover:underline"
        >
          ← Home
        </Link>
      </div>
    </Card>
  );
}
