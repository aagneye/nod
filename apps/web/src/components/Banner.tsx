import { Link, useLocation } from 'react-router-dom';
import { REPO_URL } from '../config';
import { useNodConfig } from '../lib/nodConfig';
import { toggleTheme, useDarkTheme } from '../lib/theme';
import { CHIP_TONES, NetworkBadge, type BadgeTone } from './ui';
import { WalletButton } from './WalletButton';

const NAV = [
  { to: '/', label: 'Home' },
  { to: '/how', label: 'How it works' },
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

/** HSP status pill: live, simulated, unreachable, or the API itself is offline. */
function useHspPill(): { tone: BadgeTone; text: string } | null {
  const { config, error, loading } = useNodConfig();
  if (config) {
    if (config.hsp.mode === 'mock') return { tone: 'warn', text: 'HSP · simulated' };
    return config.hsp.reachable ? { tone: 'ok', text: 'HSP · live' } : { tone: 'bad', text: 'HSP · unreachable' };
  }
  if (error) return { tone: 'bad', text: 'API offline' };
  return loading ? { tone: 'neutral', text: 'connecting' } : null;
}

const navClass = (active: boolean): string =>
  `text-[11px] font-bold tracking-[0.16em] uppercase transition ${active ? 'text-accent' : 'text-muted hover:text-ink'}`;

/** Sticky header: logo, nav, network, HSP status, theme, wallet; plus the simulation banner when HSP is mocked. */
export function Banner() {
  const location = useLocation();
  const { config } = useNodConfig();
  const pill = useHspPill();
  const receiptsChain = config?.receipts?.chainId;
  const simulated = config?.hsp.mode === 'mock';

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3.5">
        <Link to="/" className="flex shrink-0 items-center gap-2.5 text-ink">
          <Logo />
          <span className="display text-xl">Nod</span>
        </Link>

        <nav className="ml-3 hidden items-center gap-6 md:flex">
          {NAV.map((item) => (
            <Link key={item.to} to={item.to} className={navClass(location.pathname === item.to)}>
              {item.label}
            </Link>
          ))}
          <a href={REPO_URL} target="_blank" rel="noreferrer" className={navClass(false)}>
            Repo ↗
          </a>
        </nav>

        <div className="ml-auto flex items-center gap-2.5">
          {receiptsChain ? (
            <span className="hidden sm:inline-flex">
              <NetworkBadge chainId={receiptsChain} />
            </span>
          ) : null}
          {pill ? <span className={`chip hidden lg:inline-flex ${CHIP_TONES[pill.tone]}`}>{pill.text}</span> : null}
          <ThemeToggle />
          <WalletButton />
        </div>
      </div>

      {/* Below md the nav moves to its own row. */}
      <div className="border-t border-line bg-soft/60 md:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-1 px-4 py-1.5 text-[10px]">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`font-bold tracking-[0.16em] uppercase underline-offset-2 hover:underline ${
                location.pathname === item.to ? 'text-accent' : 'text-muted hover:text-ink'
              }`}
            >
              {item.label}
            </Link>
          ))}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="font-bold tracking-[0.16em] text-muted uppercase underline-offset-2 hover:text-ink hover:underline"
          >
            Repo ↗
          </a>
          {receiptsChain ? (
            <span className="ml-auto inline-flex sm:hidden">
              <NetworkBadge chainId={receiptsChain} />
            </span>
          ) : null}
        </div>
      </div>

      {simulated ? (
        <div className="border-t border-[#7c4a03]/35 bg-[#fde8c8] text-[#7c4a03]" role="status">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2 text-[11px]">
            <b className="tracking-[0.16em] uppercase">Simulation mode — no real payment</b>
            <span className="text-[#7c4a03]/85">
              HSP is simulated on this server: no tokens move and nothing is paid.
            </span>
          </div>
        </div>
      ) : null}
    </header>
  );
}
