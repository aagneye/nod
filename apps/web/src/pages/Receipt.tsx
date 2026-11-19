import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { decodeMemo, hashRequest, verifyReceipt } from '@nod/protocol';
import { decodeTransaction, hexToBin } from '@bitauth/libauth';
import { ChainOnlyReceipt, ReceiptCard, type VerifiedEntry } from '../components/ReceiptCard';
import { Card, Spinner } from '../components/ui';
import { getChain } from '../lib/chain';
import { loadApproved } from '../lib/approvals';

type ViewState =
  | { phase: 'loading' }
  | { phase: 'verified'; entries: VerifiedEntry[] }
  | { phase: 'chain'; memos: { kind: string; hash: string }[] }
  | { phase: 'nomemo' }
  | { phase: 'notfound'; message: string };

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** /tx/:txid — the receipt: verify the payment against the request(s) we approved. */
export default function ReceiptPage() {
  const { txid = '' } = useParams();
  const [view, setView] = useState<ViewState>({ phase: 'loading' });

  useEffect(() => {
    if (!txid) {
      setView({ phase: 'notfound', message: 'No transaction id in the URL.' });
      return;
    }
    let cancelled = false;
    (async () => {
      setView({ phase: 'loading' });
      try {
        const chain = await getChain();
        const approved = loadApproved(txid);

        if (approved && approved.length > 0) {
          const batchHashes = approved.length > 1 ? approved.map((s) => hashRequest(s.req)) : undefined;
          const entries: VerifiedEntry[] = [];
          for (const signed of approved) {
            const check = await verifyReceipt(chain, txid, signed.req, hashRequest(signed.req), {
              ...(batchHashes ? { batchHashes } : {}),
            });
            entries.push({ signed, check });
          }
          if (!cancelled) setView({ phase: 'verified', entries });
          return;
        }

        // No stored request (fresh browser or shared link): show what the chain says.
        let hex: string;
        try {
          hex = await chain.getTransactionHex(txid);
        } catch (e) {
          if (!cancelled) setView({ phase: 'notfound', message: errorText(e) });
          return;
        }
        const tx = decodeTransaction(hexToBin(hex));
        if (typeof tx === 'string') {
          if (!cancelled) setView({ phase: 'notfound', message: tx });
          return;
        }
        const memos = tx.outputs
          .map((output) => decodeMemo(output.lockingBytecode))
          .filter((m): m is NonNullable<typeof m> => m !== null)
          .map((m) => ({ kind: m.kind, hash: [...m.hash].map((b) => b.toString(16).padStart(2, '0')).join('') }));
        if (!cancelled) setView(memos.length > 0 ? { phase: 'chain', memos } : { phase: 'nomemo' });
      } catch (e) {
        if (!cancelled) setView({ phase: 'notfound', message: errorText(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [txid]);

  if (view.phase === 'loading') {
    return (
      <Card className="mx-auto max-w-2xl flex items-center gap-3 py-8">
        <Spinner />
        <p className="text-sm text-muted">Verifying transaction {txid.slice(0, 12)}…</p>
      </Card>
    );
  }
  if (view.phase === 'verified') return <ReceiptCard txid={txid} entries={view.entries} />;
  if (view.phase === 'chain') return <ChainOnlyReceipt txid={txid} memos={view.memos} />;
  if (view.phase === 'nomemo') return <ChainOnlyReceipt txid={txid} noMemo />;

  return (
    <Card className="mx-auto max-w-2xl">
      <span className="label">Receipt</span>
      <h1 className="display mt-2 text-2xl">Transaction not found</h1>
      <p className="mt-3 break-all text-sm text-muted">{view.message}</p>
      <p className="mt-4 text-xs text-faint">
        If it was just broadcast, wait a few seconds for the Electrum server to see it and reload.
      </p>
    </Card>
  );
}
