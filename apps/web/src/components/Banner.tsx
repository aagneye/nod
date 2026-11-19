import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { EMBER_ADDRESS, REPO_URL, SLIDES_URL } from '../config';
import { networkLabel, onChainStatus, type ChainStatus } from '../lib/chain';
import { shortAddress } from '../lib/address';
import { toggleTheme, useDarkTheme } from '../lib/theme';
import { WalletButton } from './WalletButton';

const STATUS: Record<ChainStatus, { cls: string; text: string }> = {
  idle: { cls: 'chip-plain', text: 'standby' },
  connecting: { cls: 'chip-warn', text: 'connecting' },
  live: { cls: 'chip', text: `${networkLabel()} · live` },
  error: { cls: 'chip-bad', text: 'offline' },
};

const NAV = [
  { to: '/', label: 'Home' },
  { to: '/batch', label: 'Batch' },
] as const;

/** Round serif mark — a nod, a block, a signature target. */
function Logo() {
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-full border-2 border-ink bg-ink font-display text-lg italic text-bg">
      N
    </span>
  );
}

function ThemeToggle() {
  const dark = useDarkTheme();
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="grid size-9 place-items-center border border-line bg-panel text-sm transition hover:border-strong"
    >
      {dark ? '☀' : '☾'}
    </button>
  );
}

/**
 * Hackathon-required header: slides, repo and the EMBER2026 address stay on
 * every route; the rest is the product chrome — nav, theme, chain status,
 * wallet.
 */
export function Banner() {
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<ChainStatus>('idle');
  const location = useLocation();

  useEffect(() => onChainStatus(setStatus), []);

  const copyEmber = async () => {
    if (!EMBER_ADDRESS) return;
    try {
      await navigator.clipboard.writeText(EMBER_ADDRESS);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the address is selectable in the DOM below */
    }
  };

  const pill = STATUS[status];

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3.5">
        <Link to="/" className="flex shrink-0 items-center gap-2.5 text-ink">
          <Logo />
          <span className="display text-xl">Nod</span>
        </Link>

        <nav className="ml-3 hidden items-center gap-6 md:flex">
          {NAV.map((item) => {
            const active = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`text-[11px] font-bold tracking-[0.16em] uppercase transition ${
                  active ? 'text-accent' : 'text-muted hover:text-ink'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <a
            href={SLIDES_URL}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] font-bold tracking-[0.16em] text-muted uppercase transition hover:text-ink"
          >
            Slides ↗
          </a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] font-bold tracking-[0.16em] text-muted uppercase transition hover:text-ink"
          >
            Repo ↗
          </a>
        </nav>

        <div className="ml-auto flex items-center gap-2.5">
          <ThemeToggle />
          <span className={`hidden sm:inline-flex ${pill.cls}`}>
            {pill.text}
          </span>
          <WalletButton />
        </div>
      </div>

      {/* Submission-gate row: slides, repo, EMBER2026 address. */}
      <div className="border-t border-line bg-soft/60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-1 px-4 py-1.5 text-[10px]">
          <span className="font-bold tracking-[0.18em] text-accent uppercase">Blaze 2026</span>
          <span className="hidden font-bold tracking-[0.16em] text-faint uppercase sm:inline">
            Submission
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
            {EMBER_ADDRESS ? (
              <>
                <span className="font-bold tracking-[0.16em] text-faint uppercase">EMBER2026</span>
                <code
                  className="max-w-[40vw] truncate text-[10px] text-muted sm:max-w-[18rem]"
                  title={EMBER_ADDRESS}
                >
                  {shortAddress(EMBER_ADDRESS, 10)}
                </code>
                <button
                  type="button"
                  onClick={copyEmber}
                  className="border border-line px-2 py-0.5 text-[9px] font-bold tracking-[0.14em] uppercase transition hover:border-strong hover:text-ink"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </>
            ) : (
              <span className="font-bold tracking-[0.14em] text-warn uppercase">
                VITE_EMBER2026_ADDRESS not set
              </span>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
