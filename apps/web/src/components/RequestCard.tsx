import { useEffect, useState } from 'react';
import type { Network, SignedNodRequest } from '@nod/protocol';
import { formatAmount, formatExpiry, expiryLabel, satsLine } from '../lib/format';
import { shortAddress } from '../lib/address';
import { copyText } from '../lib/clipboard';
import { Badge, Card, NetworkBadge } from './ui';

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

/** Full vendor address with a copy button; wraps on narrow screens instead of scrolling. */
function VendorLine({ vendor }: { vendor: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    if (await copyText(vendor)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <div className="mt-4 flex items-start gap-3">
      <p className="min-w-0 flex-1 break-all font-mono text-[11px] leading-relaxed text-faint">{vendor}</p>
      <button
        type="button"
        onClick={() => void onCopy()}
        className="shrink-0 border border-line px-2 py-1 text-[9px] font-bold tracking-[0.14em] uppercase transition hover:border-strong hover:text-ink"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export interface RequestCardProps {
  signed: SignedNodRequest;
  signatureValid: boolean;
  expired: boolean;
  paidTxid?: string | null;
  network: Network;
}

/** The judge-facing view of one agent request: who, what, how much, to whom, until when. */
export function RequestCard({ signed, signatureValid, expired, paidTxid, network }: RequestCardProps) {
  const { req } = signed;
  const now = useNowSeconds(signatureValid && !expired);
  const sats = satsLine(req.amount);

  const rows: [string, React.ReactNode][] = [
    ['Pay to', <span className="font-mono text-ink">{shortAddress(req.vendor, 10)}</span>],
    ['For', <span className="text-ink">{req.purpose}</span>],
    ['Agent key', <span className="font-mono text-xs text-muted">{req.agent.slice(0, 16)}…</span>],
    ['Expires', <span className="text-ink">{formatExpiry(req.expiry)}</span>],
  ];

  return (
    <Card className="relative">
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

      <span className="eyebrow mt-6">Purchase request</span>
      {/* The one sentence a judge needs: who wants to pay how much, to whom, for what. */}
      <h2 className="display mt-4 text-3xl break-words sm:text-4xl">{req.agentName}</h2>
      <p className="mt-2 text-sm text-muted">
        {signatureValid ? 'signed this request and ' : ''}wants to pay{' '}
        <b className="text-ink">{formatAmount(req.amount)}</b> to{' '}
        <span className="font-mono text-ink">{shortAddress(req.vendor, 6)}</span> for{' '}
        <span className="text-ink">“{req.purpose}”</span>.
      </p>

      <div className="rule mt-6 pt-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <p className="display text-4xl tabular-nums break-all sm:text-5xl">{formatAmount(req.amount)}</p>
          <NetworkBadge network={network} />
        </div>
        {sats ? <p className="label mt-2">{sats}</p> : null}
      </div>

      <dl className="mt-5">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="flex items-baseline justify-between gap-3 border-b border-line py-3 last:border-b-0"
          >
            <dt className="label shrink-0">{k}</dt>
            <dd className="min-w-0 text-right text-sm break-words">{v}</dd>
          </div>
        ))}
      </dl>

      {req.vendor ? <VendorLine vendor={req.vendor} /> : null}
    </Card>
  );
}
