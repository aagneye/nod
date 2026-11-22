import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ReceiptCheck, SignedNodRequest } from '@nod/protocol';
import { EXPLORER_TX, NETWORK } from '../config';
import { buyFromVendor, type BuyResult } from '../lib/api';
import { copyText } from '../lib/clipboard';
import { formatAmount } from '../lib/format';
import { shortAddress } from '../lib/address';
import { Badge, Card, NetworkBadge, Spinner } from './ui';

export interface VerifiedEntry {
  signed: SignedNodRequest;
  check: ReceiptCheck;
  /** Agent signature check (known when the request came from the URL); undefined = not re-checked here. */
  signatureValid?: boolean;
}

function TxRow({ txid }: { txid: string }) {
  return (
    <div className="border border-line bg-soft p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="label">Transaction</span>
        <NetworkBadge network={NETWORK} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <code className="min-w-0 break-all text-xs text-muted">{txid}</code>
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

/** Copies the current URL (which carries the request payload) so anyone can re-verify. */
function ShareButton() {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    if (await copyText(window.location.href)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      className="font-bold tracking-[0.14em] text-muted uppercase underline-offset-4 hover:text-ink hover:underline"
    >
      {copied ? 'Link copied' : 'Copy shareable receipt'}
    </button>
  );
}

/** "Delivered by the vendor": the demo vendor checks the receipt itself and hands over the item. */
function DeliveredItem({ txid, signed }: { txid: string; signed: SignedNodRequest }) {
  const [result, setResult] = useState<BuyResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    void buyFromVendor(txid, signed, { signal: controller.signal }).then((r) => {
      if (!controller.signal.aborted) setResult(r);
    });
    return () => controller.abort();
  }, [txid, signed, attempt]);

  if (result?.status === 'unavailable') return null; // no demo vendor here: hide quietly

  return (
    <div className="mt-6 border-2 border-ink bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="eyebrow">Delivered by the vendor</span>
        {result?.status === 'delivered' ? (
          <Badge tone="ok" dot>
            Vendor verified payment
          </Badge>
        ) : null}
      </div>

      {result === null ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted">
          <Spinner /> Vendor is checking the payment on-chain…
        </p>
      ) : result.status === 'delivered' ? (
        <>
          <h3 className="display mt-4 text-2xl break-words">{result.item.title}</h3>
          <p className="mt-2 text-sm leading-relaxed whitespace-pre-line break-words text-ink">{result.item.body}</p>
          <p className="mt-3 text-[10px] font-bold tracking-[0.14em] text-faint uppercase">
            Delivered {new Date(result.item.deliveredAt).toLocaleString()}
          </p>
        </>
      ) : (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-muted">The vendor has not seen this payment yet.</p>
          {result.reasons.length > 0 ? (
            <ul className="space-y-1">
              {result.reasons.map((r) => (
                <li key={r} className="text-xs break-words text-faint">
                  · {r}
                </li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="text-[10px] font-bold tracking-[0.14em] text-accent uppercase underline-offset-4 hover:underline"
          >
            Ask the vendor again →
          </button>
        </div>
      )}
    </div>
  );
}

/** Result view for /tx/:txid — verified against the paid request(s), or what the chain alone shows. */
export function ReceiptCard({ txid, entries }: { txid: string; entries: VerifiedEntry[] }) {
  const allOk = entries.length > 0 && entries.every((e) => e.check.ok);
  const single = entries.length === 1 ? entries[0] : undefined;
  // Any agent may buy from the demo vendor (e.g. Claude via MCP); the vendor itself decides.
  // It answers 400 for requests that are not its own, and DeliveredItem then hides itself.
  const showDelivery = single !== undefined && single.check.ok;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
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
        {entries.map(({ signed, check, signatureValid }) => (
          <li key={signed.req.id} className="border border-line p-4 not-last:mb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 text-sm font-bold tracking-[0.1em] break-words uppercase">
                {signed.req.agentName}
              </span>
              <span className="display text-xl">{formatAmount(signed.req.amount)}</span>
            </div>
            <p className="mt-1.5 text-sm break-words text-muted">
              {signed.req.purpose} → <span className="font-mono">{shortAddress(signed.req.vendor, 8)}</span>
            </p>
            {signatureValid === false ? (
              <p className="mt-2 text-xs text-danger">✗ Agent signature on this request is invalid</p>
            ) : null}
            {check.ok ? (
              <p className="mt-3 text-[10px] font-bold tracking-[0.14em] text-accent uppercase">
                ✓ Paid exactly as requested · memo commits this request
              </p>
            ) : (
              <ul className="mt-3 space-y-1">
                {check.reasons.map((reason) => (
                  <li key={reason} className="text-xs break-words text-danger">
                    ✗ {reason}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      {showDelivery ? <DeliveredItem txid={txid} signed={single.signed} /> : null}

      <div className="rule mt-6 flex flex-wrap gap-x-6 gap-y-3 pt-4 text-[10px]">
        <Link
          to="/"
          className="font-bold tracking-[0.14em] text-muted uppercase underline-offset-4 hover:text-ink hover:underline"
        >
          ← Home
        </Link>
        <ShareButton />
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

/** Shown when the receipt URL carries no request and this tab has none stored (bare /tx/<txid> link). */
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
        <div className="min-w-0">
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
        This link carries no request, so only the on-chain memo is shown. Receipt links created by Nod include the
        signed request after the <code>#</code> and verify it against the payment.
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
