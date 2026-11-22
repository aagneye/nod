import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { decodeLink, findField, hashTerms, verifyTerms, type TermsVerification } from '@nod/protocol';
import { QuoteCard } from '../components/QuoteCard';
import { TermsCard } from '../components/TermsCard';
import { Badge, Card, ErrorNote, FriendlyErrorNote, PrimaryButton, Spinner } from '../components/ui';
import { ApiError, finishPayment, getReceipt, startPayment } from '../lib/api';
import { chainLabel, HSK_MAINNET_ID, isTestnet } from '../lib/chains';
import { friendlyError, type FriendlyError } from '../lib/errors';
import { savePayer } from '../lib/flowStore';
import { formatDateTime, shortAddress, shortHash } from '../lib/format';
import { paymentChainId, useNodConfig } from '../lib/nodConfig';
import { sameAsk, toQuote, type Quote } from '../lib/quote';
import { payloadFromHash, receiptPath } from '../lib/receiptLink';
import { useNowSeconds } from '../lib/useNow';
import { useWallet } from '../wallet/context';

type Phase =
  | { name: 'review' }
  | { name: 'connecting' }
  | { name: 'quoting'; previous?: Quote }
  | { name: 'quote'; quote: Quote; notice?: string }
  | { name: 'signing'; quote: Quote; notice?: string }
  | { name: 'submitting'; quote: Quote }
  | { name: 'unavailable'; detail: string };

interface PaidInfo {
  path: string;
  txHash?: string;
}

const QUOTE_EXPIRED_NOTICE =
  'The HSP quote expired before your signature reached it (quotes last about 5 minutes). Here is a fresh one: sign once more.';

const asString = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);

/** Where an existing receipt lives: its HSP flow when the server knows it, else the anchored receipt. */
function paidInfo(receipt: unknown, payload: string): PaidInfo {
  const flowId = asString(findField(receipt, ['flowId']));
  const paymentRequestId = asString(findField(receipt, ['paymentRequestId']));
  return {
    path: receiptPath(flowId, paymentRequestId, payload),
    txHash: asString(findField(receipt, ['settlementTx', 'txHash'])),
  };
}

/** /r#<payload> — the approval page: inspect the agent's terms, get HSP's quote, then nod. */
export default function RequestPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const wallet = useWallet();
  const { config } = useNodConfig();

  const payload = payloadFromHash(location.hash);
  const decoded = useMemo(() => {
    try {
      return { ok: true as const, signed: decodeLink(payload) };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) };
    }
  }, [payload]);

  const [verification, setVerification] = useState<TermsVerification | null>(null);
  const [paid, setPaid] = useState<PaidInfo | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: 'review' });
  const [error, setError] = useState<FriendlyError | null>(null);
  const now = useNowSeconds(decoded.ok);

  const terms = decoded.ok ? decoded.signed.terms : null;
  const termsHash = useMemo(() => {
    if (!terms) return undefined;
    try {
      return hashTerms(terms);
    } catch {
      return undefined;
    }
  }, [terms]);

  // Signature and fields, checked in the browser before anything else happens.
  useEffect(() => {
    setVerification(null);
    setPaid(null);
    setPhase({ name: 'review' });
    setError(null);
    if (!decoded.ok) return;
    let cancelled = false;
    void verifyTerms(decoded.signed).then((result) => {
      if (!cancelled) setVerification(result);
    });
    return () => {
      cancelled = true;
    };
  }, [decoded]);

  // Already paid? A receipt anchored on HSK Chain for these terms says so. Never blocks the page.
  useEffect(() => {
    if (!termsHash) return;
    let cancelled = false;
    getReceipt(termsHash).then(
      (lookup) => {
        if (!cancelled && lookup.anchored) {
          setPaid({ path: receiptPath(undefined, undefined, payload), txHash: paidInfo(lookup.receipt, payload).txHash });
        }
      },
      () => {
        /* no API or no contract: /api/pay/start checks again */
      },
    );
    return () => {
      cancelled = true;
    };
  }, [termsHash, payload]);

  const runStart = useCallback(
    async (payer: string, notice?: string, previous?: Quote): Promise<Quote | null> => {
      if (!decoded.ok) return null;
      setError(null);
      setPhase({ name: 'quoting', previous });
      try {
        const quote = toQuote(await startPayment(decoded.signed, payer));
        setPhase({ name: 'quote', quote, notice });
        return quote;
      } catch (e) {
        if (e instanceof ApiError && e.code === 'already_paid') {
          setPaid(paidInfo(e.body?.receipt, payload));
          setPhase({ name: 'review' });
          return null;
        }
        if (e instanceof ApiError && e.code === 'hsp_unavailable') {
          setPhase({ name: 'unavailable', detail: e.message });
          return null;
        }
        setError(friendlyError(e, 'start'));
        setPhase(previous ? { name: 'quote', quote: previous } : { name: 'review' });
        return null;
      }
    },
    [decoded, payload],
  );

  /** Connect if needed, then ask HSP for a quote for this wallet. */
  const onNod = async () => {
    setError(null);
    setPhase({ name: 'connecting' });
    let payer: string;
    try {
      payer = await wallet.ensureConnected();
    } catch (e) {
      setError(friendlyError(e, 'connect'));
      setPhase({ name: 'review' });
      return;
    }
    await runStart(payer);
  };

  const onRequote = async (previous: Quote) => {
    setError(null);
    let payer: string;
    try {
      payer = await wallet.ensureConnected();
    } catch (e) {
      setError(friendlyError(e, 'connect'));
      return;
    }
    await runStart(payer, undefined, previous);
  };

  /** Sign HSP's authorization, hand it to HSP, and follow the payment on the receipt page. */
  const signAndFinish = async (quote: Quote, retried = false): Promise<void> => {
    setError(null);
    setPhase({ name: 'signing', quote, notice: retried ? QUOTE_EXPIRED_NOTICE : undefined });
    let signature: string;
    try {
      signature = await wallet.signTypedData(quote.eip712);
    } catch (e) {
      setError(friendlyError(e, 'sign'));
      setPhase({ name: 'quote', quote });
      return;
    }
    setPhase({ name: 'submitting', quote });
    try {
      const res = await finishPayment({
        flowId: quote.flowId,
        paymentRequestId: quote.paymentRequestId,
        signature,
        opaque: quote.opaque,
      });
      const flowId = res.flowId || quote.flowId;
      if (quote.payer) savePayer(flowId, quote.payer);
      navigate(receiptPath(flowId, res.paymentRequestId || quote.paymentRequestId, payload));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'quote_expired') {
        // Quotes last about 5 minutes: prepare again and, if nothing changed, ask for the new signature.
        const fresh = await runStart(quote.payer, QUOTE_EXPIRED_NOTICE, quote);
        if (fresh && !retried && sameAsk(fresh, quote)) await signAndFinish(fresh, true);
        return;
      }
      setError(friendlyError(e, 'finish'));
      setPhase({ name: 'quote', quote });
    }
  };

  if (!decoded.ok || !terms) {
    return (
      <Card className="mx-auto max-w-2xl">
        <Badge tone="bad" dot>
          Invalid link
        </Badge>
        <h1 className="display mt-3 text-2xl">This payment link is not readable</h1>
        <div className="mt-4">
          <ErrorNote>{decoded.ok ? 'No terms in this link.' : decoded.message}</ErrorNote>
        </div>
        <p className="mt-4 text-sm text-muted">
          Ask the agent for a fresh link, or press “Try the demo” on the{' '}
          <Link to="/" className="text-accent underline-offset-4 hover:underline">
            home page
          </Link>
          .
        </p>
      </Card>
    );
  }

  const signatureValid =
    verification === null ? null : verification.recovered.toLowerCase() === terms.agent.toLowerCase();
  const expired = now >= terms.expiry;
  const option = config?.hsp.option;
  const chainId = paymentChainId(config);
  const quotePhase =
    phase.name === 'quote' || phase.name === 'signing' || phase.name === 'submitting'
      ? phase
      : phase.name === 'quoting' && phase.previous
        ? { name: 'quoting' as const, quote: phase.previous }
        : null;

  const fundsNote =
    config?.hsp.mode === 'mock'
      ? 'Simulation mode: HSP is simulated on this server, so nothing is paid.'
      : option && isTestnet(option.chainId)
        ? `Test tokens on ${chainLabel(option.chainId)}: they have no value.`
        : option?.chainId === HSK_MAINNET_ID
          ? `This moves real ${option.coin} on HSK Chain mainnet.`
          : option
            ? `This moves real ${option.coin} on ${chainLabel(option.chainId)}.`
            : null;

  return (
    <div className="mx-auto max-w-2xl">
      <TermsCard
        terms={terms}
        signatureValid={signatureValid}
        expired={expired}
        now={now}
        termsHash={termsHash}
        paymentChainId={chainId}
        coin={option?.coin}
        alreadyPaid={paid !== null}
      />

      <div className="mt-5 space-y-3">
        {signatureValid === false ? (
          <>
            <ErrorNote>
              Signature invalid: these terms were changed after the agent signed them, or signed by a different key. Do
              not pay them.
            </ErrorNote>
            {verification?.reason ? <p className="font-mono text-[11px] break-words text-faint">{verification.reason}</p> : null}
          </>
        ) : paid ? (
          <Card className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-accent">These terms have already been paid.</p>
              {paid.txHash ? (
                <p className="mt-1 font-mono text-[11px] text-faint" title={paid.txHash}>
                  Settlement {shortHash(paid.txHash)}
                </p>
              ) : null}
            </div>
            <PrimaryButton onClick={() => navigate(paid.path)}>
              View receipt <span aria-hidden="true">↗</span>
            </PrimaryButton>
          </Card>
        ) : expired ? (
          <ErrorNote>These terms expired at {formatDateTime(terms.expiry)}. Ask the agent for a fresh link.</ErrorNote>
        ) : phase.name === 'unavailable' ? (
          <Card>
            <Badge tone="bad" dot>
              HSP unavailable
            </Badge>
            <h3 className="display mt-4 text-2xl">Payments are paused for a moment</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Nod executes every payment through HSP, the HashKey Settlement Platform. The Nod server cannot reach HSP
              right now, so it cannot prepare a quote. Nothing was signed and nothing was charged.
            </p>
            {phase.detail ? <p className="mt-2 font-mono text-[11px] break-words text-faint">{phase.detail}</p> : null}
            <div className="mt-5">
              <PrimaryButton onClick={() => void onNod()}>
                Try again <span aria-hidden="true">↻</span>
              </PrimaryButton>
            </div>
          </Card>
        ) : quotePhase ? (
          <>
            <QuoteCard
              quote={quotePhase.quote}
              terms={terms}
              wallet={wallet.address}
              now={now}
              busy={
                quotePhase.name === 'signing'
                  ? 'signing'
                  : quotePhase.name === 'submitting'
                    ? 'submitting'
                    : quotePhase.name === 'quoting'
                      ? 'quoting'
                      : null
              }
              notice={'notice' in quotePhase ? quotePhase.notice : undefined}
              onSign={() => void signAndFinish(quotePhase.quote)}
              onRequote={() => void onRequote(quotePhase.quote)}
              onCancel={() => {
                setError(null);
                setPhase({ name: 'review' });
              }}
            />
            <FriendlyErrorNote error={error} />
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <PrimaryButton
                onClick={() => void onNod()}
                disabled={signatureValid !== true || phase.name !== 'review'}
                className="max-sm:w-full"
              >
                {phase.name === 'connecting' ? (
                  <span className="flex items-center gap-2">
                    <Spinner className="size-3.5 border-ink/30 border-t-ink" />
                    Connecting wallet…
                  </span>
                ) : phase.name === 'quoting' ? (
                  <span className="flex items-center gap-2">
                    <Spinner className="size-3.5 border-ink/30 border-t-ink" />
                    Asking HSP for a quote…
                  </span>
                ) : (
                  <>
                    Nod — approve payment <span aria-hidden="true">↓</span>
                  </>
                )}
              </PrimaryButton>
              {signatureValid === null ? (
                <span className="flex items-center gap-2 text-sm text-muted">
                  <Spinner /> checking the agent's signature…
                </span>
              ) : wallet.address ? (
                <span className="text-sm text-muted">
                  Paying from <code className="text-ink">{shortAddress(wallet.address)}</code>
                </span>
              ) : (
                <span className="text-sm text-muted">Your wallet connects first (OKX Wallet, MetaMask…).</span>
              )}
            </div>
            <FriendlyErrorNote error={error} />
            <p className="text-xs leading-relaxed text-faint">
              Nod asks HSP for a quote first: you see the exact token amount and recipient before anything is signed. Your
              wallet signs one authorization; HSP executes the transfer. {fundsNote}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
