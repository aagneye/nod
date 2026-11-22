import type { NodTerms } from '@nod/protocol';
import { addressUrl, chainName, parseChainId } from '../lib/chains';
import { expiryLabel, formatToken, formatUsd, shortAddress } from '../lib/format';
import { checkQuote, type Quote } from '../lib/quote';
import { AddressValue, Badge, ErrorNote, GhostButton, InfoNote, NetworkBadge, PrimaryButton, Row, Spinner } from './ui';

export interface QuoteCardProps {
  quote: Quote;
  terms: NodTerms;
  /** Connected wallet address (null when disconnected). */
  wallet: string | null;
  now: number;
  busy: 'signing' | 'submitting' | 'quoting' | null;
  notice?: string;
  onSign(): void;
  onRequote(): void;
  onCancel(): void;
}

/** HSP's quote for the terms: the exact token amount, network and parties, with a countdown, before signing. */
export function QuoteCard({ quote, terms, wallet, now, busy, notice, onSign, onRequote, onCancel }: QuoteCardProps) {
  const { option } = quote;
  const checks = checkQuote(quote, terms, wallet);
  const expired = quote.quoteExpiresAt !== undefined && now >= quote.quoteExpiresAt;
  const tokenText = formatToken(quote.tokenTotalRaw, option.decimals, option.coin);
  const tokenParts = tokenText.split(' ');
  const tokenUrl = addressUrl(option.chainId, option.contractAddress);

  const signChainId = parseChainId(quote.eip712.domain.chainId) ?? option.chainId;
  const blocked = !checks.payToMatches;
  const needsRequote = !blocked && (expired || !checks.payerMatches);

  return (
    <div className="card-orange p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="eyebrow">HSP quote</span>
        {quote.quoteExpiresAt !== undefined ? (
          <Badge tone={expired ? 'bad' : 'warn'} dot>
            {expired ? 'Quote expired' : `Quote valid for ${expiryLabel(quote.quoteExpiresAt, now)}`}
          </Badge>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap items-end gap-x-4 gap-y-3">
        <p className="display text-4xl tabular-nums break-all sm:text-5xl">
          {tokenParts[0]}
          {tokenParts.length > 1 ? (
            <span className="ml-2 align-top font-sans text-sm font-bold tracking-[0.14em] text-muted">
              {tokenParts.slice(1).join(' ')}
            </span>
          ) : null}
        </p>
        <NetworkBadge chainId={option.chainId} />
      </div>
      <p className="label mt-2">
        For {formatUsd(terms.amountUsd)} USD of terms · {option.paymentProtocol} authorization
      </p>

      <dl className="mt-5">
        <Row label="Network">
          <span className="text-ink">
            {option.network} <span className="text-faint">· {chainName(option.chainId)}</span>
          </span>
        </Row>
        <Row label="Token">
          <span className="inline-flex flex-wrap items-center justify-end gap-x-2.5">
            <span className="text-ink">{option.coin}</span>
            <AddressValue address={option.contractAddress} href={tokenUrl} copy={false} />
          </span>
        </Row>
        <Row label="Payer (you)">
          <AddressValue address={quote.payer} href={addressUrl(option.chainId, quote.payer)} />
        </Row>
        <Row label="Pay to">
          <span className="block">
            <AddressValue address={quote.payTo || terms.payTo} href={addressUrl(option.chainId, quote.payTo || terms.payTo)} />
            <span className={`mt-1 block text-[11px] ${checks.payToMatches ? 'text-faint' : 'font-bold text-danger'}`}>
              {checks.payToMatches ? '✓ same address the agent signed' : '✗ not the address the agent signed'}
            </span>
          </span>
        </Row>
      </dl>

      {!checks.amountMatches && checks.expectedRaw !== undefined ? (
        <div className="mt-4">
          <InfoNote>
            HSP quotes {tokenText}; the terms ask for {formatToken(checks.expectedRaw, option.decimals, option.coin)}.
            Check the amount before you sign.
          </InfoNote>
        </div>
      ) : null}

      <details className="mt-4 border border-line bg-bg/60 px-3 py-2 text-xs text-muted">
        <summary className="cursor-pointer font-bold tracking-[0.12em] uppercase">What your wallet will sign</summary>
        <p className="mt-2 leading-relaxed">
          An EIP-712 {quote.eip712.primaryType} message for HSP, exactly as HSP built it, on {chainName(signChainId)}.
          Signing is not a transaction: HSP's
          Gateway executes the transfer.
        </p>
        <pre className="mt-2 max-h-64 overflow-auto bg-panel p-2 text-[11px] leading-relaxed text-ink">
          {JSON.stringify(
            { domain: quote.eip712.domain, primaryType: quote.eip712.primaryType, message: quote.eip712.message },
            null,
            2,
          )}
        </pre>
      </details>

      <div className="mt-5 space-y-3">
        {notice ? <InfoNote>{notice}</InfoNote> : null}
        {blocked ? (
          <ErrorNote>
            HSP's quote pays {shortAddress(quote.payTo)}, but the agent signed for {shortAddress(terms.payTo)}. Nod will
            not sign it.
          </ErrorNote>
        ) : null}
        {!blocked && !checks.payerMatches && wallet ? (
          <InfoNote>
            This quote was prepared for {shortAddress(quote.payer)}, but your wallet now uses {shortAddress(wallet)}. Get
            a new quote for this account.
          </InfoNote>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {blocked ? null : needsRequote ? (
            <PrimaryButton onClick={onRequote} disabled={busy !== null} className="max-sm:w-full">
              {busy === 'quoting' ? (
                <span className="flex items-center gap-2">
                  <Spinner className="size-3.5 border-ink/30 border-t-ink" />
                  Asking HSP…
                </span>
              ) : (
                <>
                  Get a new quote <span aria-hidden="true">↻</span>
                </>
              )}
            </PrimaryButton>
          ) : (
            <PrimaryButton onClick={onSign} disabled={busy !== null} className="max-sm:w-full">
              {busy === 'signing' ? (
                <span className="flex items-center gap-2">
                  <Spinner className="size-3.5 border-ink/30 border-t-ink" />
                  Check your wallet…
                </span>
              ) : busy === 'submitting' ? (
                <span className="flex items-center gap-2">
                  <Spinner className="size-3.5 border-ink/30 border-t-ink" />
                  Sending to HSP…
                </span>
              ) : busy === 'quoting' ? (
                <span className="flex items-center gap-2">
                  <Spinner className="size-3.5 border-ink/30 border-t-ink" />
                  New quote…
                </span>
              ) : (
                <>
                  Sign in wallet <span aria-hidden="true">↓</span>
                </>
              )}
            </PrimaryButton>
          )}
          <GhostButton onClick={onCancel} disabled={busy === 'signing' || busy === 'submitting'}>
            Cancel
          </GhostButton>
        </div>
        <p className="text-xs text-faint">
          Your wallet switches to {chainName(signChainId)} if needed, then asks for one signature. Nothing moves until
          HSP receives it.
        </p>
      </div>
    </div>
  );
}
