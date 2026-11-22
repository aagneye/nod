import type { NodTerms } from '@nod/protocol';
import { addressUrl } from '../lib/chains';
import { expiryLabel, formatDateTime, formatUsd, shortAddress, shortHash } from '../lib/format';
import { AddressValue, Badge, Card, CopyButton, ExplorerLink, NetworkBadge, Row } from './ui';

export interface TermsCardProps {
  terms: NodTerms;
  /** null while the signature is still being checked. */
  signatureValid: boolean | null;
  expired: boolean;
  /** Countdown clock (unix seconds). */
  now: number;
  termsHash?: string;
  /** Chain the payment will settle on (from HSP's payment option), for explorer links and the badge. */
  paymentChainId?: number;
  /** Token HSP settles in, e.g. "USDC". */
  coin?: string;
  alreadyPaid?: boolean;
}

/** The payer-facing view of one set of agent terms: who asks, how much, to whom, for what, until when. */
export function TermsCard({
  terms,
  signatureValid,
  expired,
  now,
  termsHash,
  paymentChainId,
  coin,
  alreadyPaid,
}: TermsCardProps) {
  const amount = formatUsd(terms.amountUsd);
  const payToUrl = addressUrl(paymentChainId, terms.payTo);

  return (
    <Card className="relative">
      <div className="flex flex-wrap items-center gap-2">
        {signatureValid === null ? (
          <Badge tone="neutral" dot>
            Checking signature…
          </Badge>
        ) : signatureValid ? (
          <Badge tone="ok" dot>
            Signature valid
          </Badge>
        ) : (
          <Badge tone="bad" dot>
            Signature invalid
          </Badge>
        )}
        {alreadyPaid ? (
          <Badge tone="ok" dot>
            Already paid
          </Badge>
        ) : null}
        <Badge tone={expired ? 'bad' : 'warn'} dot>
          {expired ? 'Expired' : `Expires in ${expiryLabel(terms.expiry, now)}`}
        </Badge>
      </div>

      <span className="eyebrow mt-6">Payment request</span>
      {/* The one sentence a payer needs: who asks how much, to whom, for what. */}
      <h2 className="display mt-4 text-3xl break-words sm:text-4xl">{terms.merchant}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        {signatureValid ? 'signed this request and asks' : 'asks'} you to pay{' '}
        <b className="text-ink">{amount} USD</b> to{' '}
        <span className="font-mono text-ink" title={terms.payTo}>
          {shortAddress(terms.payTo)}
        </span>{' '}
        for <span className="text-ink">“{terms.purpose}”</span>.
      </p>

      <div className="rule mt-6 pt-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <p className="display text-4xl tabular-nums break-all sm:text-5xl">
            {amount}
            <span className="ml-2 align-top font-sans text-sm font-bold tracking-[0.14em] text-muted">USD</span>
          </p>
          {paymentChainId ? <NetworkBadge chainId={paymentChainId} /> : null}
        </div>
        <p className="label mt-2">{coin ? `Settled in ${coin} through HSP` : 'Settled through HSP'}</p>
      </div>

      <dl className="mt-5">
        <Row label="Pay to">
          <AddressValue address={terms.payTo} href={payToUrl} />
        </Row>
        <Row label="For">
          <span className="text-ink">{terms.purpose}</span>
        </Row>
        <Row label="Agent key">
          <AddressValue address={terms.agent} href={addressUrl(paymentChainId, terms.agent)} />
        </Row>
        <Row label="Expires">
          <span className="text-ink">{formatDateTime(terms.expiry)}</span>
        </Row>
        {termsHash ? (
          <Row label="Terms hash">
            <span className="inline-flex items-center gap-2.5">
              <code className="text-[12px] text-muted" title={termsHash}>
                {shortHash(termsHash)}
              </code>
              <CopyButton text={termsHash} />
            </span>
          </Row>
        ) : null}
      </dl>

      {/* Full recipient, wrapping instead of scrolling on narrow screens. */}
      <div className="mt-4 flex items-start gap-3">
        <p className="min-w-0 flex-1 font-mono text-[11px] leading-relaxed break-all text-faint">{terms.payTo}</p>
        <ExplorerLink href={payToUrl} />
      </div>
    </Card>
  );
}
