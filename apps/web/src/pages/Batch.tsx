import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  buildPayment,
  decodeLink,
  findPayment,
  hashRequest,
  MAX_BATCH,
  toHex,
  type SignedNodRequest,
} from '@nod/protocol';
import { Badge, Card, ErrorNote, FriendlyErrorNote, GhostButton, PrimaryButton, Spinner } from '../components/ui';
import { friendlyError, type FriendlyError } from '../lib/errors';
import { receiptPath } from '../lib/receiptLink';
import { NETWORK } from '../config';
import { saveApproved } from '../lib/approvals';
import { fetchDemoBatch } from '../lib/api';
import { getChain } from '../lib/chain';
import { formatAmount } from '../lib/format';
import { shortAddress } from '../lib/address';
import { useWallet } from '../wallet/context';
import { collectUtxos, signAndBroadcast, walletAddresses } from '../wallet/wizard';

/** How many requests the demo button asks the demo agent for. */
const DEMO_COUNT = 3;
/** Never let the "already paid?" scan hold the Nod button longer than this. */
const PAID_CHECK_TIMEOUT_MS = 8000;
/** Vendor history entries to scan per request (same budget as the single-request page). */
const PAID_CHECK_MAX_TXS = 25;

type ParsedLine =
  | { signed: SignedNodRequest; hash: string; error?: undefined }
  | { signed?: undefined; error: string };

type ValidLine = { signed: SignedNodRequest; hash: string };

/** Pull the base64url payload out of a pasted link or a bare payload. */
const extractPayload = (line: string): string => {
  const hashIndex = line.indexOf('#');
  return hashIndex >= 0 ? line.slice(hashIndex + 1).trim() : line.trim();
};

const parseLines = (text: string): ParsedLine[] => {
  const seen = new Set<string>();
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): ParsedLine => {
      try {
        const result = decodeLink(extractPayload(line));
        if (!result.valid) return { error: 'signature invalid' };
        if (result.expired) return { error: 'expired' };
        const hash = toHex(hashRequest(result.signed.req));
        if (seen.has(hash)) return { error: 'duplicate request' };
        seen.add(hash);
        return { signed: result.signed, hash };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    });
};

const satsOf = (s: SignedNodRequest): number => ('sats' in s.req.amount ? s.req.amount.sats : 0);

/** /batch — several request links, one approval, one transaction with a batch memo. */
export default function BatchPage() {
  const navigate = useNavigate();
  const wallet = useWallet();
  const [searchParams] = useSearchParams();
  const [text, setText] = useState('');
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);
  /** request hash → txid that already paid it, or null when the scan found nothing. */
  const [paidBy, setPaidBy] = useState<Record<string, string | null>>({});
  const [checkingPaid, setCheckingPaid] = useState(false);

  const parsed = useMemo(() => (text.trim() ? parseLines(text) : []), [text]);
  const valid = parsed.filter((p): p is ValidLine & { error?: undefined } => !!p.signed);
  const invalid = parsed.filter((p): p is { error: string; signed?: undefined } => !!p.error);
  const payable = valid.filter((p) => !paidBy[p.hash]);
  const alreadyPaid = valid.length - payable.length;

  const totalSats = payable.reduce((sum, p) => sum + satsOf(p.signed), 0);
  const tokenCount = payable.length - payable.filter((p) => 'sats' in p.signed.req.amount).length;

  const loadDemo = async () => {
    setLoadingDemo(true);
    setDemoError(null);
    setError(null);
    try {
      const { links } = await fetchDemoBatch(DEMO_COUNT);
      setText(links.join('\n'));
    } catch (e) {
      setDemoError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingDemo(false);
    }
  };

  // /batch?demo=1 (from the home page): fill the box with fresh demo requests once.
  const autoLoaded = useRef(false);
  const wantsDemo = searchParams.get('demo') === '1';
  useEffect(() => {
    if (!wantsDemo || autoLoaded.current) return;
    autoLoaded.current = true;
    void loadDemo();
  }, [wantsDemo]);

  // Paid check: scan each vendor's recent history for a tx committing each request.
  const validKey = valid.map((p) => p.hash).join(',');
  const runId = useRef(0);
  useEffect(() => {
    const pending = valid.filter((p) => !(p.hash in paidBy));
    if (pending.length === 0) {
      setCheckingPaid(false);
      return;
    }
    const batchHashes = valid.map((p) => hashRequest(p.signed.req));
    const batchRequests = valid.map((p) => p.signed.req);
    const run = ++runId.current;
    let released = false;
    setCheckingPaid(true);
    // Release the button after a timeout even if scans are still running;
    // a late "already paid" result still marks the line and drops it from the payment.
    const release = setTimeout(() => {
      released = true;
      if (run === runId.current) setCheckingPaid(false);
    }, PAID_CHECK_TIMEOUT_MS);
    void (async () => {
      let chain: Awaited<ReturnType<typeof getChain>>;
      try {
        chain = await getChain();
      } catch {
        // Chain unreachable: do not block approval; building the payment reports its own error.
        clearTimeout(release);
        if (run === runId.current) setCheckingPaid(false);
        return;
      }
      await Promise.allSettled(
        pending.map(async (p) => {
          // Pass the whole list so a batch payment of this exact set is recognised too.
          const found = await findPayment(chain, p.signed.req, hashRequest(p.signed.req), {
            maxTxs: PAID_CHECK_MAX_TXS,
            ...(batchHashes.length > 1 ? { batchHashes, batchRequests } : {}),
          });
          // Results are facts about the request hash, so keep them even if the list changed.
          setPaidBy((prev) => ({ ...prev, [p.hash]: found ? found.txid : null }));
        }),
      );
      clearTimeout(release);
      if (!released && run === runId.current) setCheckingPaid(false);
    })();
    return () => clearTimeout(release);
    // Re-run only when the set of requests changes; `paidBy` is read for skipping.
  }, [validKey]);

  const onNod = async () => {
    if (payable.length === 0) return;
    setError(null);
    setPaying(true);
    try {
      if (wallet.state !== 'connected' || !wallet.manager) {
        throw new Error('Connect your wallet first — scan the QR with Paytaca or Selene.');
      }
      const manager = wallet.manager;
      const utxos = await collectUtxos(manager);
      if (utxos.length === 0) {
        throw new Error(
          NETWORK === 'chipnet'
            ? 'This wallet has no spendable BCH. Get test coins from tbch.googol.cash first.'
            : 'This wallet has no spendable BCH.',
        );
      }
      const { change } = walletAddresses(manager);
      const built = buildPayment({
        network: NETWORK,
        payments: payable.map((p) => ({
          vendor: p.signed.req.vendor,
          amount: p.signed.req.amount,
          requestHash: hashRequest(p.signed.req),
        })),
        utxos,
        changeAddress: change,
      });
      const names = [...new Set(payable.map((p) => p.signed.req.agentName))].join(', ');
      const { txid } = await signAndBroadcast(manager, built, `Nod batch: ${payable.length} requests (${names})`);
      saveApproved(
        txid,
        payable.map((p) => p.signed),
      );
      navigate(receiptPath(txid, payable.map((p) => p.signed)));
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl py-8 md:py-12">
      <span className="eyebrow">One signature · one transaction</span>

      <h1 className="display mt-5 text-[clamp(2.2rem,6vw,3.4rem)]">Batch approval</h1>
      <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted">
        Paste agent request links, one per line, or let the demo agent sign {DEMO_COUNT} for you. A single wallet
        signature pays them all in one transaction with a batch memo. Max {MAX_BATCH}.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <PrimaryButton onClick={() => void loadDemo()} disabled={loadingDemo || paying}>
          {loadingDemo ? (
            <>
              <Spinner className="size-3.5 border-ink/30 border-t-ink" />
              Asking the agent…
            </>
          ) : (
            <>
              Load {DEMO_COUNT} demo requests <span aria-hidden="true">↓</span>
            </>
          )}
        </PrimaryButton>
        {text.trim() ? (
          <GhostButton onClick={() => setText('')} disabled={paying}>
            Clear
          </GhostButton>
        ) : null}
      </div>
      {demoError ? (
        <div className="mt-3">
          <ErrorNote>{demoError}</ErrorNote>
        </div>
      ) : null}

      <Card className="mt-6">
        <label htmlFor="batch-input" className="label">
          Request links
        </label>
        <textarea
          id="batch-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder={'https://your-app/r#eyJ2IjoxLC4uLn0\nhttps://your-app/r#eyJ2IjoxLC4uLn0'}
          className="field mt-3"
        />

        {valid.length > 0 ? (
          <ul className="mt-5">
            {valid.map((p) => {
              const paidTxid = paidBy[p.hash];
              return (
                <li
                  key={p.hash}
                  className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-line py-3 last:border-b-0 ${
                    paidTxid ? 'opacity-70' : ''
                  }`}
                >
                  <span className="min-w-0 flex-1 text-sm break-words text-muted">
                    <span className="text-ink">{p.signed.req.purpose}</span>
                    <span className="block text-xs">
                      {p.signed.req.agentName} →{' '}
                      <span className="font-mono">{shortAddress(p.signed.req.vendor, 8)}</span>
                    </span>
                  </span>
                  {paidTxid ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone="warn">Already paid</Badge>
                      <Link
                        to={receiptPath(paidTxid, [p.signed])}
                        className="text-[11px] font-bold tracking-[0.16em] text-acid uppercase underline-offset-4 hover:underline"
                      >
                        Receipt →
                      </Link>
                    </span>
                  ) : (
                    <span className="font-bold text-ink">{formatAmount(p.signed.req.amount)}</span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}

        {invalid.length > 0 ? (
          <div className="mt-3 space-y-1">
            {invalid.map((p, i) => (
              <p key={`${p.error}-${i}`} className="text-xs break-words text-warn">
                ⚠ Skipped: {p.error}
              </p>
            ))}
          </div>
        ) : null}

        {alreadyPaid > 0 ? (
          <p className="mt-3 text-xs text-muted">
            {alreadyPaid} request{alreadyPaid === 1 ? ' is' : 's are'} already paid on chain and left out of this
            payment.
          </p>
        ) : null}

        {payable.length > 0 ? (
          <div className="rule mt-5 flex flex-wrap items-center gap-5 pt-5">
            <div>
              <p className="display text-3xl tabular-nums">
                {totalSats > 0 ? formatAmount({ sats: totalSats }) : 'Token payments'}
              </p>
              <p className="label mt-1.5">
                {payable.length} request{payable.length === 1 ? '' : 's'}
                {tokenCount > 0 ? ` + ${tokenCount} token` : ''}
              </p>
            </div>
            <PrimaryButton
              onClick={() => void onNod()}
              disabled={paying || checkingPaid || wallet.state !== 'connected' || payable.length > MAX_BATCH}
              className="ml-auto"
            >
              {paying ? (
                <>
                  <Spinner className="size-3.5 border-ink/30 border-t-ink" />
                  Waiting for wallet…
                </>
              ) : checkingPaid ? (
                <>
                  <Spinner className="size-3.5 border-ink/30 border-t-ink" />
                  Checking chain…
                </>
              ) : (
                <>
                  Nod — pay {payable.length} <span aria-hidden="true">↓</span>
                </>
              )}
            </PrimaryButton>
          </div>
        ) : null}

        {payable.length > MAX_BATCH ? (
          <div className="mt-4">
            <ErrorNote>More than {MAX_BATCH} requests in one batch.</ErrorNote>
          </div>
        ) : null}
        <div className="mt-4">
          <FriendlyErrorNote error={error} />
        </div>
        {wallet.state !== 'connected' && payable.length > 0 ? (
          <p className="mt-3 text-sm text-muted">Connect your wallet to approve.</p>
        ) : null}
      </Card>

      <div className="mt-5 flex flex-wrap items-center gap-4 text-xs text-faint">
        <Badge tone="neutral">Route /batch</Badge>
        <span>
          Every request is checked for a valid signature and looked up on chain, so a request already paid on its own
          or in this same batch is skipped.
        </span>
      </div>
    </div>
  );
}
