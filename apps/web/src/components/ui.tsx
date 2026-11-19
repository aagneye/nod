import type { ReactNode } from 'react';

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

const TONES: Record<BadgeTone, string> = {
  ok: 'chip',
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
    <span className={`${TONES[tone]} ${dot ? 'gap-2' : ''}`}>
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
