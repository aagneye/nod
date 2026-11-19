import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { buildPayment, decodeLink, findPayment, hashRequest } from '@nod/protocol';
import { RequestCard } from '../components/RequestCard';
import { Badge, Card, ErrorNote, PrimaryButton, Spinner } from '../components/ui';
import { NETWORK } from '../config';
import { getChain } from '../lib/chain';
import { saveApproved } from '../lib/approvals';
import { useWallet } from '../wallet/context';
import { collectUtxos, signAndBroadcast, walletAddresses } from '../wallet/wizard';

const humanError = (e: unknown): string => {
  const msg = e instanceof Error ? e.message : String(e);
  if (/reject|denied|cancel/i.test(msg)) return 'You rejected the signature in your wallet.';
  if (/not ready/i.test(msg)) return 'Wallet still connecting — try again in a moment.';
  return msg;
};

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
  const [error, setError] = useState<string | null>(null);

  const decodable = decoded.ok;
  const payable = decodable && decoded.valid && !decoded.expired && !paidTxid;

  // Paid check: scan the vendor's history for a tx committing this request.
  useEffect(() => {
    if (!payable) {
      setCheckingPaid(false);
      return;
    }
    let cancelled = false;
    setCheckingPaid(true);
    (async () => {
      try {
        const chain = await getChain();
        const found = await findPayment(chain, decoded.signed.req, hashRequest(decoded.signed.req));
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
      if (utxos.length === 0) {
        throw new Error(
          NETWORK === 'chipnet'
            ? 'This wallet has no spendable BCH. Get test coins from tbch.googol.cash first.'
            : 'This wallet has no spendable BCH.',
        );
      }
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
      navigate(`/tx/${txid}`);
    } catch (e) {
      setError(humanError(e));
    } finally {
      setPaying(false);
    }
  };

  if (!decodable) {
    return (
      <Card>
        <Badge tone="bad" dot>
          Invalid link
        </Badge>
        <h1 className="display mt-3 text-2xl">This request link is not readable</h1>
        <div className="mt-4">
          <ErrorNote>{decoded.message}</ErrorNote>
        </div>
        <p className="mt-4 text-sm text-muted">
          Ask the agent for a fresh link, or open the demo button on the{' '}
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
      <RequestCard signed={signed} signatureValid={valid} expired={expired} paidTxid={paidTxid} />

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
            <PrimaryButton onClick={() => navigate(`/tx/${paidTxid}`)}>
              View receipt <span aria-hidden="true">↗</span>
            </PrimaryButton>
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <PrimaryButton onClick={() => void onNod()} disabled={paying || checkingPaid || wallet.state !== 'connected'}>
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
                <span className="text-sm text-muted">Connect your wallet to approve.</span>
              ) : null}
            </div>
            <ErrorNote>{error}</ErrorNote>
            <p className="text-xs text-faint">
              Paying sends real {NETWORK === 'mainnet' ? 'BCH mainnet' : 'Chipnet'} funds straight to the vendor — your
              wallet signs, nothing else holds your money.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
