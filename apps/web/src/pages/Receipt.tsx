import { useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { decodeMemo, hashRequest, verifyReceipt, type SignedNodRequest } from '@nod/protocol';
import { decodeTransaction, hexToBin } from '@bitauth/libauth';
import { ChainOnlyReceipt, ReceiptCard, type VerifiedEntry } from '../components/ReceiptCard';
import { Card, Spinner } from '../components/ui';
import { getChain } from '../lib/chain';
import { loadApproved, saveApproved } from '../lib/approvals';
import { requestsFromHash } from '../lib/receiptLink';

type ViewState =
  | { phase: 'loading' }
  | { phase: 'verified'; entries: VerifiedEntry[] }
  | { phase: 'chain'; memos: { kind: string; hash: string }[] }
  | { phase: 'nomemo' }
  | { phase: 'notfound'; message: string };

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * /tx/:txid[#payload…] — the receipt: verify the payment against the request(s)
 * that were approved. The requests come from the URL fragment (shareable, works
 * in a fresh browser) or, failing that, from this tab's sessionStorage.
 */
export default function ReceiptPage() {
  const { txid = '' } = useParams();
  const { hash } = useLocation();
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

        const fromUrl = requestsFromHash(hash);
        let approved: SignedNodRequest[] | null = null;
        const sigValid = new Map<string, boolean>();
        if (fromUrl && fromUrl.length > 0) {
          approved = fromUrl.map((r) => r.signed);
          for (const r of fromUrl) sigValid.set(r.signed.req.id, r.valid);
          saveApproved(txid, approved);
        } else {
          approved = loadApproved(txid);
        }

        if (approved && approved.length > 0) {
          const batchHashes = approved.length > 1 ? approved.map((s) => hashRequest(s.req)) : undefined;
          const entries: VerifiedEntry[] = [];
          for (const signed of approved) {
            const check = await verifyReceipt(chain, txid, signed.req, hashRequest(signed.req), {
              ...(batchHashes ? { batchHashes } : {}),
            });
            entries.push({ signed, check, signatureValid: sigValid.get(signed.req.id) });
          }
          if (!cancelled) setView({ phase: 'verified', entries });
          return;
        }

        // No request available (bare /tx/<txid> link): show what the chain says.
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
  }, [txid, hash]);

  if (view.phase === 'loading') {
    return (
      <Card className="mx-auto flex max-w-2xl items-center gap-3 py-8">
        <Spinner />
        <p className="min-w-0 text-sm text-muted">Verifying transaction {txid.slice(0, 12)}…</p>
      </Card>
    );
  }
  if (view.phase === 'verified') {
    return (
      <div className="mx-auto max-w-2xl">
        <ReceiptCard txid={txid} entries={view.entries} />
      </div>
    );
  }
  if (view.phase === 'chain') {
    return (
      <div className="mx-auto max-w-2xl">
        <ChainOnlyReceipt txid={txid} memos={view.memos} />
      </div>
    );
  }
  if (view.phase === 'nomemo') {
    return (
      <div className="mx-auto max-w-2xl">
        <ChainOnlyReceipt txid={txid} noMemo />
      </div>
    );
  }

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
