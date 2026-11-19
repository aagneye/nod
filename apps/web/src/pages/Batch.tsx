import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildPayment, decodeLink, hashRequest, MAX_BATCH, type SignedNodRequest } from '@nod/protocol';
import { Badge, Card, ErrorNote, PrimaryButton, Spinner } from '../components/ui';
import { NETWORK } from '../config';
import { saveApproved } from '../lib/approvals';
import { formatAmount } from '../lib/format';
import { shortAddress } from '../lib/address';
import { useWallet } from '../wallet/context';
import { collectUtxos, signAndBroadcast, walletAddresses } from '../wallet/wizard';

type ParsedLine =
  | { signed: SignedNodRequest; error?: undefined }
  | { signed?: undefined; error: string };

/** Pull the base64url payload out of a pasted link or a bare payload. */
const extractPayload = (line: string): string => {
  const hashIndex = line.indexOf('#');
  return hashIndex >= 0 ? line.slice(hashIndex + 1).trim() : line.trim();
};

const parseLines = (text: string): ParsedLine[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        const result = decodeLink(extractPayload(line));
        if (!result.valid) return { error: 'signature invalid' };
        if (result.expired) return { error: 'expired' };
        return { signed: result.signed };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    });

/** /batch — several request links, one approval, one transaction with a batch memo. */
export default function BatchPage() {
  const navigate = useNavigate();
  const wallet = useWallet();
  const [text, setText] = useState('');
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => (text.trim() ? parseLines(text) : []), [text]);
  const valid = parsed.filter((p): p is { signed: SignedNodRequest; error?: undefined } => !!p.signed);
  const invalid = parsed.filter((p): p is { error: string; signed?: undefined } => !!p.error);

  const totalSats = valid.reduce((sum, p) => sum + ('sats' in p.signed.req.amount ? p.signed.req.amount.sats : 0), 0);
  const tokenCount = valid.length - valid.filter((p) => 'sats' in p.signed.req.amount).length;

  const onNod = async () => {
    if (valid.length === 0) return;
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
      const { change } = walletAddresses(manager);
      const built = buildPayment({
        network: NETWORK,
        payments: valid.map((p) => ({
          vendor: p.signed.req.vendor,
          amount: p.signed.req.amount,
          requestHash: hashRequest(p.signed.req),
        })),
        utxos,
        changeAddress: change,
      });
      const names = [...new Set(valid.map((p) => p.signed.req.agentName))].join(', ');
      const { txid } = await signAndBroadcast(manager, built, `Nod batch: ${valid.length} requests (${names})`);
      saveApproved(
        txid,
        valid.map((p) => p.signed),
      );
      navigate(`/tx/${txid}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl py-8 md:py-12">
      <span className="eyebrow">One signature · one transaction</span>

      <h1 className="display mt-5 text-[clamp(2.2rem,6vw,3.4rem)]">Batch approval</h1>
      <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted">
        Paste agent request links, one per line. A single wallet signature pays them all in one transaction with a
        batch memo. Max {MAX_BATCH}.
      </p>

      <Card className="mt-8">
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
            {valid.map((p) => (
              <li
                key={p.signed.req.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-3 last:border-b-0"
              >
                <span className="text-sm text-muted">
                  {p.signed.req.agentName} → <span className="font-mono text-ink">{shortAddress(p.signed.req.vendor, 8)}</span>
                </span>
                <span className="font-bold text-ink">{formatAmount(p.signed.req.amount)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {invalid.length > 0 ? (
          <div className="mt-3 space-y-1">
            {invalid.map((p, i) => (
              <p key={`${p.error}-${i}`} className="text-xs text-warn">
                ⚠ Skipped: {p.error}
              </p>
            ))}
          </div>
        ) : null}

        {valid.length > 0 ? (
          <div className="rule mt-5 flex flex-wrap items-center gap-5 pt-5">
            <div>
              <p className="display text-3xl tabular-nums">
                {totalSats > 0 ? formatAmount({ sats: totalSats }) : 'Token payments'}
              </p>
              <p className="label mt-1.5">
                {valid.length} request{valid.length === 1 ? '' : 's'}
                {tokenCount > 0 ? ` + ${tokenCount} token` : ''}
              </p>
            </div>
            <PrimaryButton
              onClick={() => void onNod()}
              disabled={paying || wallet.state !== 'connected' || valid.length > MAX_BATCH}
              className="ml-auto"
            >
              {paying ? (
                <>
                  <Spinner className="size-3.5 border-ink/30 border-t-ink" />
                  Waiting for wallet…
                </>
              ) : (
                <>
                  Nod — pay {valid.length} <span aria-hidden="true">↓</span>
                </>
              )}
            </PrimaryButton>
          </div>
        ) : null}

        {valid.length > MAX_BATCH ? (
          <div className="mt-4">
            <ErrorNote>More than {MAX_BATCH} requests in one batch.</ErrorNote>
          </div>
        ) : null}
        <div className="mt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
        {wallet.state !== 'connected' && valid.length > 0 ? (
          <p className="mt-3 text-sm text-muted">Connect your wallet to approve.</p>
        ) : null}
      </Card>

      <div className="mt-5 flex flex-wrap items-center gap-4 text-xs text-faint">
        <Badge tone="neutral">Route /batch</Badge>
        <span>Every request is checked for a valid signature before it can be paid.</span>
      </div>
    </div>
  );
}
