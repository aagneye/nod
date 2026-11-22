import { findField, type NodTerms } from '@nod/protocol';
import type { BuyResult, PaymentOption, SettleResponse } from '../lib/api';
import { addressUrl, chainName, parseChainId, txUrl } from '../lib/chains';
import { friendlyError } from '../lib/errors';
import { formatDateTime, formatToken, formatUsd, shortAddress, toUnixSeconds } from '../lib/format';
import type { OnceState } from '../lib/useOnce';
import { AddressValue, Badge, CopyButton, ExplorerLink, FriendlyErrorNote, NetworkBadge, Row, Spinner } from './ui';

const retryClass =
  'text-[10px] font-bold tracking-[0.14em] text-accent uppercase underline-offset-4 hover:underline';

/** One line: who asked, how much, for what, to whom. */
export function TermsSummary({ terms }: { terms: NodTerms }) {
  return (
    <p className="mt-3 text-sm leading-relaxed text-muted">
      <b className="text-ink">{terms.merchant}</b> asked for <b className="text-ink">{formatUsd(terms.amountUsd)} USD</b>{' '}
      for <span className="text-ink">“{terms.purpose}”</span>, paid to{' '}
      <code className="text-ink" title={terms.payTo}>
        {shortAddress(terms.payTo)}
      </code>
      .
    </p>
  );
}

interface AnchoredFields {
  settlementTx?: string;
  chainId?: number;
  payer?: string;
  payTo?: string;
  amount?: string;
  anchoredAt?: number;
  settlementUrl?: string;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value
    ? value
    : typeof value === 'number' || typeof value === 'bigint'
      ? String(value)
      : undefined;

/** A NodReceipts receipt as the server serialized it (field names read loosely). */
function readAnchored(receipt: unknown): AnchoredFields {
  return {
    settlementTx: text(findField(receipt, ['settlementTx', 'txHash'])),
    chainId: parseChainId(findField(receipt, ['chainId'])),
    payer: text(findField(receipt, ['payer'])),
    payTo: text(findField(receipt, ['payTo'])),
    amount: text(findField(receipt, ['amount'])),
    anchoredAt: toUnixSeconds(findField(receipt, ['anchoredAt'])),
    settlementUrl: text(findField(receipt, ['settlementExplorerUrl'])),
  };
}

/** Rows for a receipt anchored in NodReceipts: which settlement paid the terms, on which network. */
export function AnchoredReceiptRows({
  receipt,
  option,
  contract,
  recorder,
  receiptsChainId,
  links = {},
}: {
  receipt: unknown;
  option?: PaymentOption;
  contract?: string | null;
  recorder?: string | null;
  receiptsChainId?: number;
  /** Explorer pages the server already resolved (GET /api/receipt). */
  links?: { contract?: string; recorder?: string; settlementTx?: string };
}) {
  const r = readAnchored(receipt);
  const amount =
    r.amount && option && r.chainId === option.chainId
      ? formatToken(r.amount, option.decimals, option.coin)
      : r.amount
        ? `${r.amount} base units`
        : undefined;
  return (
    <dl className="mt-3">
      {r.settlementTx ? (
        <Row label="Settlement tx">
          <span className="inline-flex flex-wrap items-center justify-end gap-x-2.5 gap-y-1">
            <code className="text-[12px] text-ink" title={r.settlementTx}>
              {shortAddress(r.settlementTx, 8)}
            </code>
            <ExplorerLink href={links.settlementTx ?? r.settlementUrl ?? txUrl(r.chainId, r.settlementTx)} />
          </span>
        </Row>
      ) : null}
      {r.chainId ? (
        <Row label="Paid on">
          <span className="inline-flex flex-wrap items-center justify-end gap-2">
            <span className="text-ink">{chainName(r.chainId)}</span>
            <NetworkBadge chainId={r.chainId} />
          </span>
        </Row>
      ) : null}
      {r.payer ? (
        <Row label="Payer">
          <AddressValue address={r.payer} href={addressUrl(r.chainId, r.payer)} />
        </Row>
      ) : null}
      {r.payTo ? (
        <Row label="Pay to">
          <AddressValue address={r.payTo} href={addressUrl(r.chainId, r.payTo)} />
        </Row>
      ) : null}
      {amount ? (
        <Row label="Amount">
          <span className="text-ink">{amount}</span>
        </Row>
      ) : null}
      {r.anchoredAt ? (
        <Row label="Anchored">
          <span className="text-ink">{formatDateTime(r.anchoredAt)}</span>
        </Row>
      ) : null}
      {contract ? (
        <Row label="NodReceipts">
          <AddressValue address={contract} href={links.contract ?? addressUrl(receiptsChainId, contract)} />
        </Row>
      ) : null}
      {recorder ? (
        <Row label="Recorder">
          <AddressValue address={recorder} href={links.recorder ?? addressUrl(receiptsChainId, recorder)} />
        </Row>
      ) : null}
    </dl>
  );
}

/** Settlement check on the payment network plus the anchor in NodReceipts on HSK Chain. */
export function SettlementProof({
  settle,
  receiptsChainId,
  receiptsContract,
  option,
  onRetry,
}: {
  settle: OnceState<SettleResponse>;
  receiptsChainId?: number;
  receiptsContract?: string | null;
  option?: PaymentOption;
  onRetry(): void;
}) {
  if (settle.state === 'idle') return null;
  if (settle.state === 'pending') {
    return (
      <p className="mt-4 flex items-center gap-2 text-sm text-muted">
        <Spinner /> Checking the transfer on chain, then anchoring the receipt on HSK Chain…
      </p>
    );
  }
  if (settle.state === 'error') {
    return (
      <div className="mt-4 space-y-3">
        <FriendlyErrorNote error={friendlyError(settle.error)} />
        <button type="button" onClick={onRetry} className={retryClass}>
          Try again →
        </button>
      </div>
    );
  }

  const { value } = settle;
  const check = value.check ?? { ok: value.ok, reasons: [] };
  const anchor = value.anchor;
  const transferred =
    check.transferredRaw && option ? formatToken(check.transferredRaw, option.decimals, option.coin) : undefined;
  const simulated = (reason?: string): boolean => !!reason && /mock|simulat/i.test(reason);

  return (
    <div className="mt-4 space-y-4">
      <div className="border border-line p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="label">Settlement check</span>
          {check.skipped ? (
            <Badge tone="warn" dot>
              Not checked
            </Badge>
          ) : check.ok ? (
            <Badge tone="ok" dot>
              Transfer verified
            </Badge>
          ) : (
            <Badge tone="bad" dot>
              Check failed
            </Badge>
          )}
        </div>
        {check.skipped ? (
          <p className="mt-2 text-sm text-muted">
            {simulated(check.reason) || !check.reason
              ? 'Simulation mode: there is no real transfer to check on chain.'
              : check.reason}
          </p>
        ) : check.ok ? (
          <p className="mt-2 text-sm text-muted">
            The token transfer on chain matches the terms: from the payer, to the agent's recipient, for at least the
            amount asked{transferred ? ` (${transferred} moved)` : ''}.
          </p>
        ) : (
          <>
            <ul className="mt-2 space-y-1">
              {(check.reasons.length > 0 ? check.reasons : ['The server could not confirm the transfer yet.']).map(
                (reason) => (
                  <li key={reason} className="text-xs break-words text-danger">
                    ✗ {reason}
                  </li>
                ),
              )}
            </ul>
            <button type="button" onClick={onRetry} className={`mt-3 ${retryClass}`}>
              Check again →
            </button>
          </>
        )}
      </div>

      {anchor ? (
        <div className="border border-line p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="label">Receipt on HSK Chain</span>
            {'txHash' in anchor ? (
              anchor.pending ? (
                <Badge tone="warn" dot>
                  Anchor sent
                </Badge>
              ) : (
                <Badge tone="ok" dot>
                  Anchored
                </Badge>
              )
            ) : 'already' in anchor ? (
              <Badge tone="ok" dot>
                Already anchored
              </Badge>
            ) : anchor.failed ? (
              <Badge tone="bad" dot>
                Anchor failed
              </Badge>
            ) : (
              <Badge tone="warn" dot>
                Not anchored
              </Badge>
            )}
          </div>
          {'txHash' in anchor ? (
            <>
              <p className="mt-2 text-sm text-muted">
                {anchor.pending
                  ? `The anchor transaction is on its way to NodReceipts on ${chainName(receiptsChainId)}; it was not mined yet when the server answered.`
                  : `NodReceipts on ${chainName(receiptsChainId)} now links these terms to the settlement transaction.`}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <code className="min-w-0 text-xs break-all text-ink">{anchor.txHash}</code>
                <CopyButton text={anchor.txHash} />
                <ExplorerLink href={anchor.explorerUrl ?? txUrl(receiptsChainId, anchor.txHash)}>Anchor tx</ExplorerLink>
              </div>
            </>
          ) : 'already' in anchor ? (
            <>
              <p className="mt-2 text-sm text-muted">This recorder anchored these terms earlier.</p>
              <AnchoredReceiptRows
                receipt={anchor.receipt}
                option={option}
                contract={receiptsContract}
                receiptsChainId={receiptsChainId}
              />
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-muted">
                {simulated(anchor.reason)
                  ? 'Simulation mode: nothing is anchored on HSK Chain.'
                  : anchor.reason || 'The server did not anchor this receipt.'}
              </p>
              {anchor.failed ? (
                <button type="button" onClick={onRetry} className={`mt-3 ${retryClass}`}>
                  Try again →
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** "Delivered by the vendor": the demo vendor checks the payment itself and hands over the item. */
export function DeliveredItem({ delivery, onRetry }: { delivery: OnceState<BuyResult>; onRetry(): void }) {
  if (delivery.state === 'idle') return null;
  const result = delivery.state === 'done' ? delivery.value : null;
  // These terms are not the demo vendor's (400) or there is no vendor here (404): nothing to deliver.
  if (result?.status === 'unavailable' && (result.httpStatus === 400 || result.httpStatus === 404)) return null;

  return (
    <div className="border-2 border-ink bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="eyebrow">Delivered by the vendor</span>
        {result?.status === 'delivered' ? (
          <Badge tone="ok" dot>
            Vendor verified payment
          </Badge>
        ) : null}
      </div>

      {delivery.state === 'pending' ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted">
          <Spinner /> The vendor is checking the payment…
        </p>
      ) : delivery.state === 'error' ? (
        <div className="mt-4 space-y-2">
          <FriendlyErrorNote error={friendlyError(delivery.error)} />
          <button type="button" onClick={onRetry} className={retryClass}>
            Ask the vendor again →
          </button>
        </div>
      ) : result?.status === 'delivered' ? (
        <>
          <h3 className="display mt-4 text-2xl break-words">{result.item.title}</h3>
          <p className="mt-2 text-sm leading-relaxed whitespace-pre-line break-words text-ink">{result.item.body}</p>
          <p className="mt-3 text-[10px] font-bold tracking-[0.14em] text-faint uppercase">
            Delivered {formatDateTime(toUnixSeconds(result.item.deliveredAt) ?? Date.now() / 1000)}
          </p>
        </>
      ) : (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-muted">
            {result?.status === 'unpaid'
              ? 'The vendor has not seen this payment yet.'
              : `The vendor could not deliver: ${result?.status === 'unavailable' ? result.message : 'unknown error'}`}
          </p>
          {result?.status === 'unpaid' && result.reasons.length > 0 ? (
            <ul className="space-y-1">
              {result.reasons.map((reason) => (
                <li key={reason} className="text-xs break-words text-faint">
                  · {reason}
                </li>
              ))}
            </ul>
          ) : null}
          <button type="button" onClick={onRetry} className={retryClass}>
            Ask the vendor again →
          </button>
        </div>
      )}
    </div>
  );
}
