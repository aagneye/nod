import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { decodeLink, hashTerms, type SignedTerms } from '@nod/protocol';
import { PaymentTimeline } from '../components/PaymentTimeline';
import { AnchoredReceiptRows, DeliveredItem, SettlementProof, TermsSummary } from '../components/ReceiptParts';
import { AddressValue, Badge, Card, CopyButton, ErrorNote, ExplorerLink, NetworkBadge, Row, Spinner } from '../components/ui';
import {
  ApiError,
  buyFromVendor,
  getPaymentStatus,
  getReceipt,
  settlePayment,
  type PayStatusResponse,
  type ReceiptLookup,
  type SettleResponse,
} from '../lib/api';
import { addressUrl, chainName, txUrl } from '../lib/chains';
import { errorMessage } from '../lib/errors';
import { loadPayer } from '../lib/flowStore';
import { FINALIZED_STEP, normalizeStatus, stepIndex } from '../lib/hspStatus';
import { useNodConfig } from '../lib/nodConfig';
import { payloadFromHash } from '../lib/receiptLink';
import { useOnce, type OnceState } from '../lib/useOnce';

const POLL_MS = 3000;
/** After "paid" (payment-safe), keep polling this many times for payment-finalized. */
const FINALITY_POLLS = 40;

const sameAddress = (a?: string, b?: string): boolean => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Consecutive failed status checks (about a minute) before polling stops and offers "Check again". */
const MAX_FAILED_POLLS = 20;

/** Why a status check failed, in words: the Nod server itself, or HSP behind it. */
const pollErrorText = (e: unknown): string =>
  e instanceof ApiError && e.status === 0
    ? 'Lost contact with the Nod server'
    : `The status check failed: ${errorMessage(e)}`;

/** GET /api/pay/status every 3 s until paid (then until finalized, briefly) or failed. */
function usePaymentStatus(flowId: string, paymentRequestId?: string) {
  const [status, setStatus] = useState<PayStatusResponse | null>(null);
  const [highest, setHighest] = useState(-1);
  const [pollError, setPollError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [round, setRound] = useState(0);

  useEffect(() => {
    setPollError(null);
    setFatal(null);
    setLive(true);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let extra = 0;
    let failures = 0;
    const controller = new AbortController();

    const tick = async () => {
      try {
        const next = await getPaymentStatus(flowId, paymentRequestId, controller.signal);
        if (cancelled) return;
        failures = 0;
        setStatus(next);
        setPollError(null);
        const index = stepIndex(next.status);
        if (index >= 0) setHighest((h) => Math.max(h, index));
        if (next.outcome === 'failed' || (next.outcome === 'paid' && (index === FINALIZED_STEP || ++extra > FINALITY_POLLS))) {
          setLive(false);
          return;
        }
      } catch (e) {
        if (cancelled) return;
        if ((e instanceof ApiError && (e.status === 400 || e.status === 404)) || ++failures >= MAX_FAILED_POLLS) {
          setFatal(e instanceof ApiError && (e.status === 400 || e.status === 404) ? e.message : pollErrorText(e));
          setPollError(null);
          setLive(false);
          return;
        }
        setPollError(pollErrorText(e));
      }
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [flowId, paymentRequestId, round]);

  // A different flow starts from scratch; "Check again" keeps what was already shown.
  useEffect(() => {
    setStatus(null);
    setHighest(-1);
  }, [flowId, paymentRequestId]);

  return { status, highest, pollError, fatal, live, retry: () => setRound((n) => n + 1) };
}

/** Headline of the proof card: only claim what the settle call actually did. */
function proofHeadline(settle: OnceState<SettleResponse>): string {
  if (settle.state !== 'done') return settle.state === 'error' ? 'Proof not recorded yet' : 'Checking on chain…';
  const { check, anchor } = settle.value;
  if (check?.skipped) return 'Simulated: nothing to prove on chain';
  if (!check?.ok) return 'The transfer did not check out yet';
  if (anchor && ('already' in anchor || ('txHash' in anchor && !anchor.pending))) {
    return 'Checked on chain, anchored on HSK Chain';
  }
  return 'Checked on chain';
}

function ShareButton() {
  return <CopyButton text={typeof window === 'undefined' ? '' : window.location.href} label="Copy receipt link" />;
}

function FooterLinks() {
  return (
    <div className="rule mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 pt-4 text-[10px]">
      <Link
        to="/"
        className="font-bold tracking-[0.14em] text-muted uppercase underline-offset-4 hover:text-ink hover:underline"
      >
        ← Home
      </Link>
      <ShareButton />
      <Link
        to="/how"
        className="font-bold tracking-[0.14em] text-muted uppercase underline-offset-4 hover:text-ink hover:underline"
      >
        How it works
      </Link>
    </div>
  );
}

/** /receipt/:flowId?pr=…#<payload> — follow the HSP payment, then the proof and the delivery. */
function LiveReceipt({
  flowId,
  paymentRequestId,
  signed,
  payload,
}: {
  flowId: string;
  paymentRequestId?: string;
  signed: SignedTerms | null;
  payload: string;
}) {
  const { config } = useNodConfig();
  const { status, highest, pollError, fatal, live, retry } = usePaymentStatus(flowId, paymentRequestId);
  const outcome = status?.outcome;
  const paid = outcome === 'paid';
  const failed = outcome === 'failed';

  // Once paid: settle exactly once (check + anchor), then ask the vendor for the item.
  const settle = useOnce(paid && signed ? `settle:${flowId}` : null, () =>
    settlePayment(signed!, flowId, paymentRequestId, status?.payer ?? loadPayer(flowId)),
  );
  const settled = settle.state === 'done' || settle.state === 'error';
  const delivery = useOnce(settled && signed ? `buy:${flowId}` : null, () =>
    buyFromVendor(signed!, flowId, paymentRequestId),
  );

  const terms = signed?.terms;
  const chainId = status?.chainId ?? config?.hsp.option?.chainId;
  const explorer = status?.txHash ? (status.explorerUrl ?? txUrl(chainId, status.txHash)) : undefined;
  const timeout = normalizeStatus(status?.status) === 'payment-timeout';

  const headline = fatal
    ? status
      ? 'Status unavailable'
      : 'Payment not found'
    : failed
      ? 'Payment failed'
      : paid
        ? 'Paid'
        : status
          ? 'Settling through HSP…'
          : 'Asking HSP…';

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="eyebrow">Receipt</span>
            <h1 className="display mt-4 text-3xl sm:text-4xl">{headline}</h1>
          </div>
          {fatal ? (
            <Badge tone="bad" dot>
              No status
            </Badge>
          ) : failed ? (
            <Badge tone="bad" dot>
              Failed
            </Badge>
          ) : paid ? (
            <Badge tone="ok" dot>
              Paid via HSP
            </Badge>
          ) : (
            <Badge tone="warn" dot>
              In progress
            </Badge>
          )}
        </div>
        {terms ? <TermsSummary terms={terms} /> : null}

        {fatal ? (
          <div className="mt-6 space-y-3">
            <ErrorNote>{fatal}</ErrorNote>
            <button
              type="button"
              onClick={retry}
              className="text-[10px] font-bold tracking-[0.14em] text-accent uppercase underline-offset-4 hover:underline"
            >
              Check again →
            </button>
          </div>
        ) : null}
        {!fatal || status ? (
          <div className="mt-6">
            <PaymentTimeline status={status?.status} outcome={outcome} highest={highest} live={live && !failed} />
          </div>
        ) : null}

        {!fatal || status ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="text-faint">
              HSP status: <code className="text-muted">{status?.status ?? '…'}</code>
            </span>
            {live && !fatal ? (
              <span className="flex items-center gap-2 text-faint">
                <Spinner className="size-3" /> checking every 3 s
              </span>
            ) : null}
          </div>
        ) : null}
        {failed ? (
          <div className="mt-3">
            <ErrorNote>
              HSP reported the payment as failed{status?.statusReason ? `: ${status.statusReason}` : '.'} No receipt will be
              anchored; you can go back to the request and nod again.
            </ErrorNote>
            {payload ? (
              <Link
                to={`/r#${payload}`}
                className="mt-3 inline-block text-[11px] font-bold tracking-[0.14em] text-accent uppercase underline-offset-4 hover:underline"
              >
                Back to the request →
              </Link>
            ) : null}
          </div>
        ) : null}
        {timeout ? (
          <p className="mt-3 text-xs text-warn">HSP reported a timeout for now; Nod keeps checking.</p>
        ) : null}
        {pollError ? (
          <p className="mt-3 text-xs break-words text-warn">{pollError}. Retrying…</p>
        ) : null}

        {status?.txHash ? (
          <div className="mt-6 border border-line bg-soft p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="label">Settlement transaction</span>
              {chainId ? <NetworkBadge chainId={chainId} /> : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <code className="min-w-0 text-xs break-all text-muted">{status.txHash}</code>
              <CopyButton text={status.txHash} />
              <ExplorerLink href={explorer} />
            </div>
            <dl className="mt-3">
              <Row label="Network">
                <span className="text-ink">
                  {status.network ? (
                    <>
                      {status.network}
                      {chainId ? <span className="text-faint"> · {chainName(chainId)}</span> : null}
                    </>
                  ) : (
                    chainName(chainId)
                  )}
                </span>
              </Row>
              {status.payer ? (
                <Row label="Payer">
                  <AddressValue address={status.payer} href={addressUrl(chainId, status.payer)} />
                </Row>
              ) : null}
              {status.payTo ? (
                <Row label="Pay to">
                  <span className="block">
                    <AddressValue address={status.payTo} href={addressUrl(chainId, status.payTo)} />
                    {terms ? (
                      <span
                        className={`mt-1 block text-[11px] ${sameAddress(status.payTo, terms.payTo) ? 'text-faint' : 'font-bold text-danger'}`}
                      >
                        {sameAddress(status.payTo, terms.payTo)
                          ? '✓ the address the agent signed'
                          : '✗ not the address the agent signed'}
                      </span>
                    ) : null}
                  </span>
                </Row>
              ) : null}
              {status.attributionVerified !== undefined ? (
                <Row label="HSP attribution">
                  {status.attributionVerified ? (
                    <Badge tone="ok">Verified</Badge>
                  ) : (
                    <Badge tone="warn">Not verified</Badge>
                  )}
                </Row>
              ) : null}
            </dl>
          </div>
        ) : null}
      </Card>

      {paid ? (
        <Card>
          <span className="eyebrow">Proof</span>
          <h2 className="display mt-4 text-2xl sm:text-3xl">{proofHeadline(settle)}</h2>
          {signed ? (
            <SettlementProof
              settle={settle}
              receiptsChainId={config?.receipts.chainId}
              receiptsContract={config?.receipts.address}
              option={config?.hsp.option}
              onRetry={settle.retry}
            />
          ) : (
            <p className="mt-4 text-sm leading-relaxed text-muted">
              This link carries no terms after the <code>#</code>, so Nod cannot check the payment against them or ask the
              vendor. Receipt links created by Nod include the signed terms.
            </p>
          )}
        </Card>
      ) : null}

      {paid && signed ? <DeliveredItem delivery={delivery} onRetry={delivery.retry} /> : null}

      <FooterLinks />
    </div>
  );
}

/** /receipt#<payload> — the receipt anchored on HSK Chain for these terms, looked up by terms hash. */
function AnchoredReceipt({ signed, payload }: { signed: SignedTerms | null; payload: string }) {
  const { config } = useNodConfig();
  const termsHash = useMemo(() => {
    if (!signed) return undefined;
    try {
      return hashTerms(signed.terms);
    } catch {
      return undefined;
    }
  }, [signed]);
  const [lookup, setLookup] = useState<{ result?: ReceiptLookup; error?: string } | null>(null);

  useEffect(() => {
    if (!termsHash) return;
    let cancelled = false;
    setLookup(null);
    getReceipt(termsHash).then(
      (result) => {
        if (!cancelled) setLookup({ result });
      },
      (e: unknown) => {
        if (!cancelled) setLookup({ error: errorMessage(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [termsHash]);

  if (!signed || !termsHash) {
    return (
      <Card className="mx-auto max-w-2xl">
        <span className="eyebrow">Receipt</span>
        <h1 className="display mt-4 text-2xl">Nothing to show</h1>
        <p className="mt-3 text-sm text-muted">
          This receipt link carries no readable terms. Receipt links created by Nod include the signed terms after the{' '}
          <code>#</code>.
        </p>
        <FooterLinks />
      </Card>
    );
  }

  const result = lookup?.result;
  const contract = (typeof result?.contract === 'string' ? result.contract : null) ?? config?.receipts.address ?? null;
  const recorder = (typeof result?.recorder === 'string' ? result.recorder : null) ?? config?.receipts.recorder ?? null;
  const receiptsChainId = result?.chainId ?? config?.receipts.chainId;
  const contractUrl =
    result?.explorer?.contract ?? addressUrl(receiptsChainId, contract, config?.receipts.explorer);

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="eyebrow">Receipt on HSK Chain</span>
            <h1 className="display mt-4 text-3xl sm:text-4xl">
              {lookup === null ? 'Looking it up…' : result?.anchored ? 'Paid and anchored' : 'No receipt yet'}
            </h1>
          </div>
          {result?.anchored ? (
            <Badge tone="ok" dot>
              Anchored
            </Badge>
          ) : lookup?.error ? (
            <Badge tone="bad" dot>
              Lookup failed
            </Badge>
          ) : lookup ? (
            <Badge tone="warn" dot>
              Not anchored
            </Badge>
          ) : null}
        </div>
        <TermsSummary terms={signed.terms} />

        {lookup === null ? (
          <p className="mt-6 flex items-center gap-2 text-sm text-muted">
            <Spinner /> Reading NodReceipts on {chainName(config?.receipts.chainId)}…
          </p>
        ) : lookup.error ? (
          <div className="mt-6">
            <ErrorNote>{lookup.error}</ErrorNote>
          </div>
        ) : result?.anchored ? (
          <AnchoredReceiptRows
            receipt={result.receipt}
            option={config?.hsp.option}
            contract={contract}
            recorder={recorder}
            receiptsChainId={receiptsChainId}
            links={result.explorer}
          />
        ) : (
          <div className="mt-6 space-y-3 text-sm text-muted">
            <p>
              Nod's recorder has not anchored these terms in NodReceipts
              {contract && contractUrl ? (
                <>
                  {' '}
                  (<a href={contractUrl} target="_blank" rel="noreferrer" className="text-accent underline-offset-4 hover:underline">
                    contract
                  </a>
                  )
                </>
              ) : null}
              . If a payment is in progress, its receipt appears once HSP reports it paid.
            </p>
            {result?.reason ? <p className="font-mono text-[11px] break-words text-faint">{result.reason}</p> : null}
            <Link
              to={`/r#${payload}`}
              className="inline-block text-[11px] font-bold tracking-[0.14em] text-accent uppercase underline-offset-4 hover:underline"
            >
              Open the request →
            </Link>
          </div>
        )}
        <dl className="mt-4">
          <Row label="Terms hash">
            <span className="inline-flex items-center gap-2.5">
              <code className="text-[12px] text-muted" title={termsHash}>
                {termsHash.slice(0, 10)}…{termsHash.slice(-8)}
              </code>
              <CopyButton text={termsHash} />
            </span>
          </Row>
        </dl>
        <FooterLinks />
      </Card>
    </div>
  );
}

/** Receipt route: live HSP flow when a flow id is in the path, else the anchored receipt for the terms. */
export default function ReceiptPage() {
  const { flowId } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const payload = payloadFromHash(location.hash);
  const signed = useMemo(() => {
    if (!payload) return null;
    try {
      return decodeLink(payload);
    } catch {
      return null;
    }
  }, [payload]);

  if (!flowId) return <AnchoredReceipt signed={signed} payload={payload} />;
  return <LiveReceipt flowId={flowId} paymentRequestId={params.get('pr') ?? undefined} signed={signed} payload={payload} />;
}
