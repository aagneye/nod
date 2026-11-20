import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { buildPayment, decodeLink, findPayment, hashRequest } from '@nod/protocol';
import { RequestCard } from '../components/RequestCard';
import { Badge, Card, ErrorNote, FriendlyErrorNote, PrimaryButton, Spinner } from '../components/ui';
import { NETWORK } from '../config';
import { getChain } from '../lib/chain';
import { saveApproved } from '../lib/approvals';
import { friendlyError, type FriendlyError } from '../lib/errors';
import { receiptPath } from '../lib/receiptLink';
import { useWallet } from '../wallet/context';
import { collectUtxos, signAndBroadcast, walletAddresses } from '../wallet/wizard';

/** Never let the "already paid?" scan hold the Nod button longer than this. */
const PAID_CHECK_TIMEOUT_MS = 8000;
/** Vendor history entries to scan; the demo vendor collects many txs and the scan is sequential. */
const PAID_CHECK_MAX_TXS = 25;

/** /r#<payload> — the approval page: inspect the agent's request, then Nod. */
export default function RequestPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const wallet = useWallet();

  const payload = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;

  const decoded = useMemo(() => {
    try {
      const result = decodeLink(payload);
      return { ok: true as const, ...result };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) };
    }
  }, [payload]);

  const [paidTxid, setPaidTxid] = useState<string | null>(null);
  const [checkingPaid, setCheckingPaid] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);

  const decodable = decoded.ok;
  const payable = decodable && decoded.valid && !decoded.expired && !paidTxid;

  // Paid check: scan the vendor's recent history for a tx committing this request.
  useEffect(() => {
    if (!payable) {
      setCheckingPaid(false);
      return;
    }
    let cancelled = false;
    setCheckingPaid(true);
    // Release the button after a timeout even if the scan is still running;
    // a late "already paid" result still flips the page to the receipt link.
    const release = setTimeout(() => {
      if (!cancelled) setCheckingPaid(false);
    }, PAID_CHECK_TIMEOUT_MS);
    (async () => {
      try {
        const chain = await getChain();
        const found = await findPayment(chain, decoded.signed.req, hashRequest(decoded.signed.req), {
          maxTxs: PAID_CHECK_MAX_TXS,
        });
        if (!cancelled && found) setPaidTxid(found.txid);
      } catch {
        // Chain unreachable: do not block approval — building the payment
        // needs the chain anyway and will report its own error.
      } finally {
        if (!cancelled) setCheckingPaid(false);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(release);
    };
  }, [decoded, payable]);

  const onNod = async () => {
    if (!payable || !decodable) return;
    setError(null);
    setPaying(true);
    try {
      if (wallet.state !== 'connected' || !wallet.manager) {
        throw new Error('Connect your wallet first — scan the QR with Paytaca or Cashonize.');
      }
      const manager = wallet.manager;
      const utxos = await collectUtxos(manager);
      if (utxos.length === 0) throw new Error('This wallet has no spendable BCH.');
      const { signed } = decoded;
      const { change } = walletAddresses(manager);
      const built = buildPayment({
        network: NETWORK,
        payments: [
          { vendor: signed.req.vendor, amount: signed.req.amount, requestHash: hashRequest(signed.req) },
        ],
        utxos,
        changeAddress: change,
      });
      const { txid } = await signAndBroadcast(
        manager,
        built,
        `Nod: pay ${signed.req.purpose} (${signed.req.agentName})`,
      );
      saveApproved(txid, [signed]);
      navigate(receiptPath(txid, [signed]));
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPaying(false);
    }
  };

  if (!decodable) {
    return (
      <Card className="mx-auto max-w-2xl">
        <Badge tone="bad" dot>
          Invalid link
        </Badge>
        <h1 className="display mt-3 text-2xl">This request link is not readable</h1>
        <div className="mt-4">
          <ErrorNote>{decoded.message}</ErrorNote>
        </div>
        <p className="mt-4 text-sm text-muted">
          Ask the agent for a fresh link, or press “Try the demo” on the{' '}
          <a href="/" className="text-accent underline-offset-4 hover:underline">
            home page
          </a>
          .
        </p>
      </Card>
    );
  }

  const { signed, valid, expired } = decoded;

  return (
    <div className="mx-auto max-w-2xl">
      <RequestCard signed={signed} signatureValid={valid} expired={expired} paidTxid={paidTxid} network={NETWORK} />

      <div className="mt-5 space-y-3">
        {!valid ? (
          <div>
            <ErrorNote>
              Signature invalid — the request was modified after the agent signed it. Do not pay it.
            </ErrorNote>
          </div>
        ) : expired ? (
          <div>
            <ErrorNote>This request expired at {new Date(signed.req.expiry * 1000).toLocaleString()}.</ErrorNote>
          </div>
        ) : paidTxid ? (
          <Card className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-accent">This request has already been paid.</p>
            <PrimaryButton onClick={() => navigate(receiptPath(paidTxid, [signed]))}>
              View receipt <span aria-hidden="true">↗</span>
            </PrimaryButton>
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <PrimaryButton
                onClick={() => void onNod()}
                disabled={paying || checkingPaid || wallet.state !== 'connected'}
                className="max-sm:w-full"
              >
                {paying ? (
                  <span className="flex items-center gap-2">
                    <Spinner className="size-3.5 border-ink/30 border-t-ink" />
                    Waiting for wallet…
                  </span>
                ) : (
                  <>
                    Nod — approve payment <span aria-hidden="true">↓</span>
                  </>
                )}
              </PrimaryButton>
              {checkingPaid ? (
                <span className="flex items-center gap-2 text-sm text-muted">
                  <Spinner /> checking it is not already paid…
                </span>
              ) : wallet.state !== 'connected' ? (
                <span className="text-sm text-muted">Connect your wallet (top right) to approve.</span>
              ) : null}
            </div>
            <FriendlyErrorNote error={error} />
            <p className="text-xs text-faint">
              Paying sends {NETWORK === 'mainnet' ? 'real BCH on mainnet' : 'Chipnet test coins'} straight to the
              vendor — your wallet signs, nothing else holds your money.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
