import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { encodeLink } from '@nod/protocol';
import { getDemoAgent, type DemoAgentResponse } from '../lib/api';
import { chainLabel } from '../lib/chains';
import { friendlyError } from '../lib/errors';
import { formatUsd } from '../lib/format';
import { useNodConfig } from '../lib/nodConfig';
import { requestPathFromLink } from '../lib/receiptLink';
import { REPO_URL } from '../config';
import { StatusPanel } from '../components/StatusPanel';
import { ErrorNote, GhostButton, NetworkBadge, PrimaryButton, Spinner } from '../components/ui';

/** The three promises, as numbered feature columns. */
const STEPS = [
  {
    step: '01',
    icon: '✎',
    iconBg: 'var(--acid)',
    title: 'The agent asks',
    text: 'Your AI agent signs payment terms with EIP-712: merchant, amount in USD, recipient, purpose, expiry. It holds no funds, only a key.',
  },
  {
    step: '02',
    icon: 'N',
    iconBg: 'var(--accent)',
    title: 'You nod',
    text: 'Open the link, check every field, see the exact token quote from HSP, and sign one authorization in OKX Wallet or MetaMask.',
  },
  {
    step: '03',
    icon: '✓',
    iconBg: 'var(--mint)',
    title: 'HSK Chain settles',
    text: 'HSP executes the transfer. Nod checks it on chain and anchors the receipt in NodReceipts on HSK Chain; the vendor delivers.',
  },
] as const;

/** Black ticker strip: real product facts, orange + separators. */
const TICKER = [
  'EIP-712 signed terms',
  'Executed through HSP',
  'OKX Wallet + MetaMask',
  'Receipts anchored on HSK Chain',
  'Spending caps with NodPolicy',
  'The agent never holds funds',
] as const;

const VERIFY_ROWS = [
  ['Signature valid', 'EIP-712 terms recover to the agent key'],
  ['Not expired', 'Every set of terms carries a deadline'],
  ['Not already paid', 'NodReceipts is checked before a new order'],
  ['Transfer on chain', 'Token, payer, recipient and amount are re-checked'],
] as const;

type Liveness = 'live' | 'simulated' | 'unreachable' | 'offline' | 'loading';

const LIVENESS_TEXT: Record<Liveness, string> = {
  live: 'HSP live',
  simulated: 'Simulation',
  unreachable: 'HSP unreachable',
  offline: 'API offline',
  loading: 'connecting…',
};

function useLiveness(): Liveness {
  const { config, error } = useNodConfig();
  if (config) return config.hsp.mode === 'mock' ? 'simulated' : config.hsp.reachable ? 'live' : 'unreachable';
  return error ? 'offline' : 'loading';
}

/**
 * Orange hero stage: a payment request awaiting a nod, on a dark phone, over the chartreuse sun,
 * with the live HSP status read from /api/config underneath.
 */
function StageBlock() {
  const { config } = useNodConfig();
  const liveness = useLiveness();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const amount = formatUsd(config?.demoUsd ?? '0.10');
  const option = config?.hsp.option;
  const good = liveness === 'live';

  return (
    <div className="relative grid min-h-[520px] place-items-center overflow-hidden border-2 border-ink bg-accent px-6 py-16">
      <p className="absolute top-5 left-5 text-[10px] leading-relaxed font-bold tracking-[0.18em] text-ink uppercase">
        Your agent asks.
        <br />
        You nod.
      </p>
      <p className="absolute right-3 bottom-6 text-[9px] font-bold tracking-[0.2em] text-ink uppercase [writing-mode:vertical-rl]">
        Ask / Nod / Settle
      </p>

      {/* Chartreuse sun behind the device. */}
      <span aria-hidden="true" className="absolute size-[300px] rounded-full bg-acid opacity-90 md:size-[340px]" />

      <div className="relative z-10 flex flex-col items-center">
        {/* The phone: one payment request, ready for a nod. */}
        <div className="w-[min(310px,82%)] -rotate-3 rounded-[36px] border-[7px] border-[#2b2b24] bg-[#171713] p-5 text-[#f8f5ed] shadow-[16px_18px_0_rgba(23,23,19,0.23)]">
          <div className="flex items-center justify-between text-[10px] font-bold">
            <span>{time}</span>
            <span className={good ? 'text-acid' : 'text-[#f4714e]'}>
              ● {LIVENESS_TEXT[liveness].toUpperCase()}
            </span>
          </div>

          <p className="mt-7 text-[10px] tracking-[0.2em] text-[#a9a89e] uppercase">Payment request</p>
          <p className="mt-1 font-display text-[52px] leading-none">
            {amount}
            <span className="ml-2 align-top text-[20px] text-acid">USD</span>
          </p>

          <div className="mt-5 rounded-[14px] bg-[#f8f5ed] p-3.5 text-[#171713]">
            <div className="flex items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent font-display text-sm font-bold text-white italic">
                N
              </span>
              <span className="min-w-0">
                <b className="block truncate text-xs">Nod demo agent</b>
                <small className="mt-0.5 block truncate text-[9px] text-[#666]">1 live weather report</small>
              </span>
            </div>
            <span className="mt-2.5 inline-block bg-mint px-2 py-1 text-[8px] font-bold tracking-[0.1em] text-[#14532d] uppercase">
              Signature valid
            </span>
          </div>

          <div className="mt-4 flex min-h-[124px] flex-col items-center justify-center rounded-[14px] border border-dashed border-[#5b5b51] bg-[#2a2a25] text-center">
            <span className="font-display text-[26px] leading-none text-acid">✓</span>
            <b className="mt-2.5 text-[13px]">Ready to nod</b>
            <small className="mt-1.5 text-[9px] tracking-[0.08em] text-[#a9a89e] uppercase">
              Sign once in your wallet
            </small>
          </div>
        </div>

        {/* Live readout under the device. */}
        <p className="mt-7 text-center text-[10px] font-bold tracking-[0.14em] text-ink uppercase">
          {LIVENESS_TEXT[liveness]}
          {option ? ` · pays in ${option.coin} on ${chainLabel(option.chainId)}` : ''}
          {config?.receipts.address ? ` · receipts on ${chainLabel(config.receipts.chainId)}` : ''}
        </p>
        <p className="mt-1.5 text-center text-[9px] font-bold tracking-[0.12em] text-ink/70 uppercase">
          Signing: EIP-712 in your wallet · Executed by HSP · Read live from /api/config
        </p>
      </div>
    </div>
  );
}

/** In-app path for the demo agent's link, whatever origin the server put in it. */
const demoPath = (demo: DemoAgentResponse): string =>
  requestPathFromLink(demo.link) ?? `/r#${encodeLink(demo.signed)}`;

/** Seconds left on the demo terms. */
const secondsLeft = (demo: DemoAgentResponse): number => (demo.signed?.terms?.expiry ?? 0) - Date.now() / 1000;

/** Home: editorial landing — hero, ticker, three moves, live status, verify band, CTA. */
export default function Home() {
  const navigate = useNavigate();
  const { config } = useNodConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefetched, setPrefetched] = useState<DemoAgentResponse | null>(null);

  // Prefetch one demo request so the button is instant and any server warning
  // (e.g. an ephemeral agent key) shows before the click.
  useEffect(() => {
    let cancelled = false;
    getDemoAgent().then(
      (demo) => {
        if (!cancelled) setPrefetched(demo);
      },
      () => {
        /* endpoint absent or down: the button reports it on click */
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const tryDemo = async () => {
    setBusy(true);
    setError(null);
    try {
      // Reuse the prefetched terms only while they have plenty of time left.
      const demo = prefetched && secondsLeft(prefetched) > 120 ? prefetched : await getDemoAgent();
      setPrefetched(null);
      navigate(demoPath(demo));
    } catch (e) {
      setError(friendlyError(e).text);
    } finally {
      setBusy(false);
    }
  };

  const tryDemoLabel = (
    <>
      Try the demo <span aria-hidden="true">↓</span>
    </>
  );

  const tickerItems = [...TICKER, ...TICKER];
  const option = config?.hsp.option;

  return (
    <div>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="grid items-start gap-10 py-8 md:grid-cols-[1.1fr_0.9fr] md:py-14">
        <div className="@container">
          <span className="eyebrow">Human-approved agent payments</span>

          <h1 className="display mt-6 text-[clamp(2.5rem,9.5cqw,4.6rem)]">
            Your agent asks.
            <br />
            You nod.
            <br />
            <span className="text-accent">HSK Chain settles.</span>
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-snug font-semibold text-ink">
            The approval and settlement layer for AI agent payments on HSK Chain, executed through HSP.
          </p>

          {/* The whole product in one glance. */}
          <ol className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-2 text-[11px] font-bold tracking-[0.14em] uppercase">
            <li className="border border-ink bg-acid px-2.5 py-1.5 text-[#171713]">1 · Agent asks</li>
            <li aria-hidden="true" className="text-accent">
              →
            </li>
            <li className="border border-ink bg-accent px-2.5 py-1.5 text-white">2 · You nod</li>
            <li aria-hidden="true" className="text-accent">
              →
            </li>
            <li className="border border-ink bg-mint px-2.5 py-1.5 text-[#14532d]">3 · HSK Chain settles</li>
          </ol>

          <p className="mt-6 max-w-xl text-[0.98rem] leading-relaxed text-muted">
            The agent signs the terms (merchant, amount, recipient, purpose, expiry) but never touches money. You check
            them, sign one payment authorization in your own wallet, and HSP, the HashKey Settlement Platform, moves the
            tokens. Nod then anchors a receipt on HSK Chain proving which terms were paid.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-6">
            <PrimaryButton onClick={() => void tryDemo()} disabled={busy} className="max-sm:w-full">
              {busy ? (
                <>
                  <Spinner className="size-3.5 border-ink/30 border-t-ink" />
                  Asking the agent…
                </>
              ) : (
                tryDemoLabel
              )}
            </PrimaryButton>
            <GhostButton onClick={() => navigate('/how')}>
              How it works <span aria-hidden="true">↗</span>
            </GhostButton>
          </div>
          <p className="mt-3 text-xs text-faint">
            A demo agent signs real terms for a {formatUsd(config?.demoUsd ?? '0.10')} payment (one live weather
            report)
            {option ? `, settled in ${option.coin} on ${chainLabel(option.chainId)}` : ''}. You review everything before
            anything is paid.
          </p>
          <div className="mt-4">
            <ErrorNote>{error}</ErrorNote>
          </div>
          {prefetched?.warning ? (
            <p className="mt-3 text-[10px] tracking-[0.08em] text-faint">
              Note from the demo agent: {prefetched.warning}
            </p>
          ) : null}

          <p className="mt-8 flex flex-wrap items-center gap-x-2 gap-y-2 text-[10px] font-bold tracking-[0.16em] text-faint uppercase">
            {option ? <NetworkBadge chainId={option.chainId} /> : null}
            {option ? <span className="mx-1 text-accent">/</span> : null}
            Real wallet signature
            <span className="mx-1 text-accent">/</span> Executed by HSP
          </p>
        </div>

        <StageBlock />
      </section>

      {/* ── Ticker ───────────────────────────────────────────── */}
      <div className="marquee full-bleed" aria-hidden="true">
        <div className="marquee-track">
          {tickerItems.map((item, i) => (
            <span key={`${item}-${i}`} className="marquee-item">
              {item} <span className="marquee-plus">+</span>
            </span>
          ))}
        </div>
      </div>

      {/* ── Three moves ──────────────────────────────────────── */}
      <section className="py-14 md:py-20">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
          <div>
            <span className="eyebrow">Three moves</span>
            <h2 className="display mt-5 text-[clamp(2rem,5vw,3.2rem)]">
              From request to paid.
              <br />
              Nothing in between.
            </h2>
          </div>
          <p className="max-w-xs text-sm leading-relaxed text-muted">
            No custodian, no keys in the browser, no vague “pending”: every HSP status is shown, and every payment ends
            with a receipt on HSK Chain.
          </p>
        </div>

        <ol className="grid gap-px border-t-2 border-ink bg-line sm:grid-cols-3">
          {STEPS.map((item) => (
            <li key={item.step} className="bg-bg p-6 sm:p-8">
              <div className="flex items-center justify-between">
                <span className="step-num">{item.step}</span>
                <span className="step-icon" style={{ background: item.iconBg }}>
                  {item.icon}
                </span>
              </div>
              <h3 className="display mt-8 text-2xl">{item.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted">{item.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Live status ──────────────────────────────────────── */}
      <section className="grid gap-10 pb-14 md:grid-cols-[0.8fr_1.2fr] md:gap-16 md:pb-20">
        <div>
          <span className="eyebrow">Wired to HSK Chain</span>
          <h2 className="display mt-5 text-[clamp(2rem,5vw,3.2rem)]">
            Nothing hidden.
            <br />
            Check the wiring.
          </h2>
          <p className="mt-6 max-w-md text-sm leading-relaxed text-muted">
            This panel reads the server's live configuration: whether HSP is reachable, which network and token it pays
            in, and where Nod's contracts live on HSK Chain. Every address links to the explorer.
          </p>
        </div>
        <StatusPanel />
      </section>

      {/* ── Black verify band ────────────────────────────────── */}
      <section className="band-inverse full-bleed">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-[1fr_1fr] md:gap-16 md:py-20">
          <div>
            <span className="eyebrow text-[#f4f3ea]">Trust the signature</span>
            <h2 className="display mt-5 text-[clamp(2rem,5vw,3.4rem)]">
              Check the terms.
              <br />
              Then move the money.
            </h2>
            <p className="mt-6 max-w-md text-sm leading-relaxed text-[#a8a89c]">
              A payment link is untrusted input. Nod verifies the agent's EIP-712 signature and the expiry before your
              wallet is asked for anything, refuses terms that already have a receipt on HSK Chain, and shows HSP's quote
              (token, amount, recipient) before you sign. After settlement the server re-checks the token transfer on
              chain before it anchors the receipt.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                to="/how"
                className="text-[11px] font-bold tracking-[0.16em] text-acid uppercase underline-offset-4 hover:underline"
              >
                See the HSP flow →
              </Link>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-bold tracking-[0.16em] text-[#a8a89c] uppercase underline-offset-4 hover:text-[#f4f3ea] hover:underline"
              >
                Read the source ↗
              </a>
            </div>
          </div>

          <div className="border border-[#3a3a34] bg-[#1a1a16] p-6 sm:p-8">
            <div className="flex items-center justify-between gap-4">
              <span className="eyebrow text-[#f4f3ea]">Verification</span>
              <span className="chip">Every payment</span>
            </div>
            <ul className="mt-6">
              {VERIFY_ROWS.map(([title, detail]) => (
                <li
                  key={title}
                  className="flex items-baseline justify-between gap-4 border-b border-[#3a3a34] py-4 last:border-b-0"
                >
                  <div>
                    <p className="text-sm font-semibold text-[#f4f3ea]">{title}</p>
                    <p className="mt-1 text-xs text-[#8f8f84]">{detail}</p>
                  </div>
                  <span className="chip shrink-0">Checked</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Orange CTA band ──────────────────────────────────── */}
      <section className="band-orange full-bleed">
        {/* Half-cut chartreuse circle, bottom right. */}
        <span aria-hidden="true" className="absolute -right-16 -bottom-24 size-64 rounded-full bg-acid md:size-80" />
        <div className="relative mx-auto max-w-6xl px-4 py-16 md:py-24">
          <span className="eyebrow text-[#fff8ef]">Ready when you are</span>
          <h2 className="display mt-6 max-w-3xl text-[clamp(2.6rem,8vw,5.5rem)] text-[#fff8ef]">Make it a nod.</h2>
          <div className="mt-10 flex flex-wrap items-center gap-6">
            <PrimaryButton onClick={() => void tryDemo()} disabled={busy}>
              {busy ? (
                <>
                  <Spinner className="size-3.5 border-ink/30 border-t-ink" />
                  Asking…
                </>
              ) : (
                tryDemoLabel
              )}
            </PrimaryButton>
            <Link
              to="/how"
              className="text-[11px] font-bold tracking-[0.16em] text-[#fff8ef] uppercase underline-offset-4 hover:underline"
            >
              How it works →
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
