import { useState, type ReactNode } from 'react';
import { chainLabel, HSK_MAINNET_ID, isTestnet } from '../lib/chains';
import { copyText } from '../lib/clipboard';
import type { FriendlyError } from '../lib/errors';
import { shortAddress } from '../lib/format';

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="loading"
      className={`inline-block size-4 animate-spin rounded-full border-2 border-ink/25 border-t-ink ${className}`}
    />
  );
}

export type BadgeTone = 'ok' | 'bad' | 'warn' | 'neutral';

/** Modifier classes on top of the base `.chip` (index.css). */
export const CHIP_TONES: Record<BadgeTone, string> = {
  ok: '',
  bad: 'chip-bad',
  warn: 'chip-warn',
  neutral: 'chip-plain',
};

/** Status chip: pale-green pill for PASS / LIVE states, variants for warn/bad. */
export function Badge({
  tone = 'neutral',
  dot = false,
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={`chip ${CHIP_TONES[tone]} ${dot ? 'gap-2' : ''}`}>
      {dot ? <span className="inline-block size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card p-5 sm:p-6 ${className}`}>{children}</div>;
}

/** Orange offset-shadow card — the accent panel for hero/receipt content. */
export function AccentCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card-orange p-5 sm:p-7 ${className}`}>{children}</div>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      className="border border-danger/40 bg-danger/10 px-4 py-2.5 text-xs font-medium leading-relaxed tracking-wide text-danger"
      role="alert"
    >
      {children}
    </p>
  );
}

/** Neutral explanatory note (warn tone), e.g. a re-quote after an expired HSP quote. */
export function InfoNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="border border-warn/40 bg-warn/10 px-4 py-2.5 text-xs font-medium leading-relaxed tracking-wide text-warn">
      {children}
    </p>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`btn-cta ${className}`}>
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  disabled,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`link-cta ${className}`}>
      {children}
    </button>
  );
}

/**
 * Loud network marker: real money (HSK Chain mainnet) vs test tokens must never be ambiguous.
 * Mainnet is solid ink, test networks are amber, anything else is plain.
 */
export function NetworkBadge({ chainId, className = '' }: { chainId: number | null | undefined; className?: string }) {
  const main = chainId === HSK_MAINNET_ID;
  const test = isTestnet(chainId);
  const tone = main ? 'border-ink bg-ink text-bg' : test ? 'border-warn bg-warn/10 text-warn' : 'border-line text-muted';
  const title = main
    ? 'HSK Chain mainnet: real funds'
    : test
      ? 'Test network: tokens here have no value'
      : `Chain ${chainId ?? 'unknown'}`;
  return (
    <span
      className={`inline-flex items-center gap-1.5 border-2 px-2 py-0.5 text-[10px] font-extrabold tracking-[0.16em] whitespace-nowrap uppercase ${tone} ${className}`}
      title={title}
    >
      <span className="inline-block size-1.5 rounded-full bg-current" />
      {chainLabel(chainId)}
    </span>
  );
}

/** ErrorNote for a FriendlyError: message, optional detail line, optional links (e.g. wallet installs). */
export function FriendlyErrorNote({ error }: { error: FriendlyError | null }) {
  if (!error) return null;
  return (
    <div
      className="border border-danger/40 bg-danger/10 px-4 py-2.5 text-xs font-medium leading-relaxed tracking-wide text-danger"
      role="alert"
    >
      <p className="break-words">{error.text}</p>
      {error.detail && error.detail !== error.text ? (
        <p className="mt-1 break-words font-mono text-[11px]">{error.detail}</p>
      ) : null}
      {error.links && error.links.length > 0 ? (
        <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
          {error.links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className="font-bold underline underline-offset-4"
            >
              {link.label} ↗
            </a>
          ))}
        </p>
      ) : null}
    </div>
  );
}

/** Small bordered Copy button that confirms for 1.5 s. */
export function CopyButton({ text, label = 'Copy', className = '' }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    if (await copyText(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      className={`shrink-0 border border-line px-2 py-1 text-[9px] font-bold tracking-[0.14em] uppercase transition hover:border-strong hover:text-ink ${className}`}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

/** Uppercase accent link that opens an explorer page in a new tab. */
export function ExplorerLink({ href, children = 'Explorer' }: { href: string | undefined; children?: ReactNode }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="shrink-0 text-[10px] font-bold tracking-[0.14em] whitespace-nowrap text-accent uppercase underline-offset-4 hover:underline"
    >
      {children} ↗
    </a>
  );
}

/** A short address with the full one on hover, a copy button and an explorer link. */
export function AddressValue({
  address,
  href,
  keep = 4,
  copy = true,
}: {
  address: string;
  href?: string;
  keep?: number;
  copy?: boolean;
}) {
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-2.5 gap-y-1">
      <code className="text-[13px] text-ink" title={address}>
        {shortAddress(address, keep)}
      </code>
      {copy ? <CopyButton text={address} /> : null}
      <ExplorerLink href={href} />
    </span>
  );
}

/** Label / value row used in every details list. */
export function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-3 last:border-b-0">
      <dt className="label shrink-0">{label}</dt>
      <dd className="min-w-0 text-right text-sm break-words">{children}</dd>
    </div>
  );
}
