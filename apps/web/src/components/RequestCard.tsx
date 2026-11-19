import { useEffect, useState } from 'react';
import type { SignedNodRequest } from '@nod/protocol';
import { formatAmount, formatExpiry, expiryLabel, satsLine } from '../lib/format';
import { shortAddress } from '../lib/address';
import { Badge, Card } from './ui';

/** Ticks once a second so the expiry countdown stays live. */
function useNowSeconds(active: boolean): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export interface RequestCardProps {
  signed: SignedNodRequest;
  signatureValid: boolean;
  expired: boolean;
  paidTxid?: string | null;
}

/** The judge-facing view of one agent request: who, what, how much, until when. */
export function RequestCard({ signed, signatureValid, expired, paidTxid }: RequestCardProps) {
  const { req } = signed;
  const now = useNowSeconds(signatureValid && !expired);
  const sats = satsLine(req.amount);

  const rows: [string, React.ReactNode][] = [
    ['Vendor', <span className="font-mono text-ink">{shortAddress(req.vendor, 14)}</span>],
    ['Purpose', <span className="text-ink">{req.purpose}</span>],
    ['Agent key', <span className="font-mono text-xs text-muted">{req.agent.slice(0, 20)}…</span>],
    ['Expires', <span className="text-ink">{formatExpiry(req.expiry)}</span>],
  ];

  return (
    <Card className="relative">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="eyebrow">Purchase request</span>
          <h2 className="display mt-4 text-3xl sm:text-4xl">{req.agentName}</h2>
          <p className="mt-2 text-sm text-muted">wants to buy something for you</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {signatureValid ? (
            <Badge tone="ok" dot>
              Signature valid
            </Badge>
          ) : (
            <Badge tone="bad" dot>
              Signature invalid
            </Badge>
          )}
          {paidTxid ? (
            <Badge tone="ok" dot>
              Already paid
            </Badge>
          ) : null}
          <Badge tone={expired ? 'bad' : 'warn'} dot>
            {expired ? 'Expired' : `Expires in ${expiryLabel(req.expiry, now)}`}
          </Badge>
        </div>
      </div>

      <div className="rule mt-6 pt-5">
        <p className="display text-4xl tabular-nums sm:text-5xl">{formatAmount(req.amount)}</p>
        {sats ? <p className="label mt-2">{sats}</p> : null}
      </div>

      <dl className="mt-5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line py-3 last:border-b-0">
            <dt className="label">{k}</dt>
            <dd className="max-w-[70%] text-right text-sm">{v}</dd>
          </div>
        ))}
      </dl>

      {req.vendor ? (
        <p className="mt-4 truncate font-mono text-[11px] text-faint" title={req.vendor}>
          {req.vendor}
        </p>
      ) : null}
    </Card>
  );
}
