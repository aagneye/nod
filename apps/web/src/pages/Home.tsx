import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchDemoAgent, type DemoLink } from '../lib/api';
import { NETWORK } from '../config';
import { getChain, getChainStatus, onChainStatus, networkLabel, type ChainStatus } from '../lib/chain';
import { ErrorNote, GhostButton, NetworkBadge, PrimaryButton, Spinner } from '../components/ui';

/** The three promises, as numbered feature columns. */
const STEPS = [
  {
    step: '01',
    icon: '✎',
    iconBg: 'var(--acid)',
    title: 'The agent asks',
    text: 'Your AI agent signs a purchase request — vendor, amount, purpose, expiry. It holds no funds, only a key.',
  },
  {
    step: '02',
    icon: 'N',
    iconBg: 'var(--accent)',
    title: 'You nod',
    text: 'Open the link, check every field, approve in your wallet over WizardConnect. One signature, one prompt.',
  },
  {
    step: '03',
    icon: '✓',
    iconBg: 'var(--mint)',
    title: 'BCH settles',
    text: 'The vendor is paid directly on Bitcoin Cash. An OP_RETURN memo commits the exact request that was paid.',
  },
] as const;

/** Black ticker strip: real product facts, orange + separators. */
const TICKER = [
  'Agent-signed requests',
  'WizardConnect approval',
  'BCH mainnet settlement',
  'OP_RETURN memo receipts',
  'Batch payments',
  'No seed phrase in the app',
] as const;

const VERIFY_ROWS = [
  ['Signature valid', 'Schnorr over the request hash'],
  ['Not expired', 'Every request carries a deadline'],
  ['Vendor unchanged', 'Payee set at signing, not at payment'],
  ['Memo commits request', 'OP_RETURN ties tx to request id'],
] as const;

const STATUS_TEXT: Record<ChainStatus, string> = {
  idle: 'standby',
  connecting: 'connecting…',
  live: 'live',
  error: 'offline',
};

/**
 * Orange hero stage: the request awaiting a nod, on a dark phone, over the
 * chartreuse sun — with the real chain status and block height underneath.
 */
function StageBlock() {
  const [status, setStatus] = useState<ChainStatus>(getChainStatus());
  const [tip, setTip] = useState<number | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => onChainStatus(setStatus), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await getChain();
        const height = await c.getBlockHeight();
        if (!cancelled) setTip(height);
      } catch {
        /* the status line already reports the failure */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const live = status === 'live';
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

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
        {/* The phone: one request, ready for a nod. */}
        <div className="w-[min(310px,82%)] -rotate-3 rounded-[36px] border-[7px] border-[#2b2b24] bg-ink p-5 text-[#f8f5ed] shadow-[16px_18px_0_rgba(23,23,19,0.23)]">
          <div className="flex items-center justify-between text-[10px] font-bold">
            <span>{time}</span>
            <span className={live ? 'text-acid' : 'text-[#f4714e]'}>
              {live ? '● LIVE' : `● ${STATUS_TEXT[status].toUpperCase()}`}
            </span>
          </div>

          <p className="mt-7 text-[10px] tracking-[0.2em] text-[#a9a89e] uppercase">Purchase request</p>
          <p className="mt-1 font-display text-[52px] leading-none">
            0.00002<span className="ml-2 align-top text-[20px] text-acid">BCH</span>
          </p>

          <div className="mt-5 rounded-[14px] bg-[#f8f5ed] p-3.5 text-ink">
            <div className="flex items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent font-display text-sm font-bold text-white italic">
                D
              </span>
              <span className="min-w-0">
                <b className="block truncate text-xs">Nod demo agent</b>
                <small className="mt-0.5 block truncate text-[9px] text-[#666]">
                  1 live weather report
                </small>
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
              Approve in your wallet
            </small>
          </div>
        </div>

        {/* Real chain readout under the device. */}
        <p className="mt-7 text-center text-[10px] font-bold tracking-[0.14em] text-ink uppercase">
          {tip !== null ? `Block ${tip.toLocaleString()}` : '—————'} · {networkLabel()} ·{' '}
          {STATUS_TEXT[status]}
        </p>
        <p className="mt-1.5 text-center text-[9px] font-bold tracking-[0.12em] text-ink/70 uppercase">
          Signing: WizardConnect · Gas for payer: none · Read live from Fulcrum
        </p>
      </div>
    </div>
  );
}

/** Seconds until `expiresAt`, accepting unix seconds or milliseconds. */
const expiresInSeconds = (expiresAt: number): number =>
  (expiresAt > 1e12 ? expiresAt / 1000 : expiresAt) - Date.now() / 1000;

/** Home: editorial landing — hero, ticker, three moves, verify band, CTA. */
export default function Home() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefetched, setPrefetched] = useState<DemoLink | null>(null);

  // Prefetch one demo request so the button is instant and any server
  // warning (e.g. an ephemeral agent key) can be shown before the click.
  useEffect(() => {
    let cancelled = false;
    fetchDemoAgent().then(
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

  /** Same-origin links stay in the SPA (keeps the wallet session warm); others do a full load. */
  const openLink = (link: string) => {
    try {
      const url = new URL(link, window.location.href);
      if (url.origin === window.location.origin) {
        navigate(`${url.pathname}${url.search}${url.hash}`);
        return;
      }
    } catch {
      /* fall through */
    }
    window.location.href = link;
  };

  const askAgent = async () => {
    setBusy(true);
    setError(null);
    try {
      // Reuse the prefetched request only while it has plenty of time left.
      const fresh =
        prefetched && (prefetched.expiresAt === undefined || expiresInSeconds(prefetched.expiresAt) > 120)
          ? prefetched
          : null;
      const demo = fresh ?? (await fetchDemoAgent());
      setPrefetched(null);
      openLink(demo.link);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
            <span className="text-accent">BCH settles.</span>
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-snug font-semibold text-ink">
            AI agents can ask to spend BCH. Only your nod, in your own wallet, pays.
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
            <li className="border border-ink bg-mint px-2.5 py-1.5 text-[#14532d]">3 · BCH settles</li>
          </ol>

          <p className="mt-6 max-w-xl text-[0.98rem] leading-relaxed text-muted">
            The agent signs a request (vendor, amount, purpose, expiry) but holds no money. You check it, approve once
            in your wallet, and the vendor is paid directly on Bitcoin Cash, with an on-chain receipt proving which
            request was paid.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-6">
            <PrimaryButton onClick={() => void askAgent()} disabled={busy} className="max-sm:w-full">
              {busy ? (
                <>
                  <Spinner className="size-3.5 border-ink/30 border-t-ink" />
                  Asking the agent…
                </>
              ) : (
                tryDemoLabel
              )}
            </PrimaryButton>
            <GhostButton onClick={() => navigate('/batch?demo=1')}>
              Pay a batch <span aria-hidden="true">↗</span>
            </GhostButton>
          </div>
          <p className="mt-3 text-xs text-faint">
            A demo agent signs a real request for a small{' '}
            {NETWORK === 'mainnet' ? 'mainnet BCH' : 'chipnet test-coin'} payment (one live weather report). You
            review it before anything is paid.
          </p>
          <div className="mt-4">
            <ErrorNote>{error}</ErrorNote>
          </div>
          {prefetched?.warning ? (
            <p className="mt-3 text-[10px] tracking-[0.08em] text-faint" title="Set NOD_DEMO_AGENT_KEY on the server">
              Note from the demo agent: {prefetched.warning} (signatures are real, but the agent key changes on
              server restart).
            </p>
          ) : null}

          <p className="mt-8 flex flex-wrap items-center gap-x-2 gap-y-2 text-[10px] font-bold tracking-[0.16em] text-faint uppercase">
            <NetworkBadge network={NETWORK} />
            <span className="mx-1 text-accent">/</span> Real wallet signature
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
            No custodian, no seed phrase in the browser, no vague “pending”. Every step is verifiable on-chain.
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

      {/* ── Black verify band ────────────────────────────────── */}
      <section className="band-inverse full-bleed">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-[1fr_1fr] md:gap-16 md:py-20">
          <div>
            <span className="eyebrow text-[#f4f3ea]">Trust the signature</span>
            <h2 className="display mt-5 text-[clamp(2rem,5vw,3.4rem)]">
              Check the request.
              <br />
              Then move the money.
            </h2>
            <p className="mt-6 max-w-md text-sm leading-relaxed text-[#a8a89c]">
              A payment link is untrusted input. Nod verifies the agent's Schnorr signature against the request
              hash before your wallet is ever asked to sign, re-reads the chain to confirm the request is still
              unpaid, and writes an OP_RETURN memo so the receipt points back at the exact request it settled.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                to="/batch?demo=1"
                className="text-[11px] font-bold tracking-[0.16em] text-acid uppercase underline-offset-4 hover:underline"
              >
                Approve a batch →
              </Link>
              <a
                href="https://github.com/aagneye/nod"
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
              <span className="chip">All pass</span>
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
                  <span className="chip shrink-0">Pass</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Orange CTA band ──────────────────────────────────── */}
      <section className="band-orange full-bleed">
        {/* Half-cut chartreuse circle, bottom right. */}
        <span
          aria-hidden="true"
          className="absolute -right-16 -bottom-24 size-64 rounded-full bg-acid md:size-80"
        />
        <div className="relative mx-auto max-w-6xl px-4 py-16 md:py-24">
          <span className="eyebrow text-[#fff8ef]">Ready when you are</span>
          <h2 className="display mt-6 max-w-3xl text-[clamp(2.6rem,8vw,5.5rem)] text-[#fff8ef]">
            Make it a nod.
          </h2>
          <div className="mt-10 flex flex-wrap items-center gap-6">
            <PrimaryButton onClick={() => void askAgent()} disabled={busy}>
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
              to="/batch?demo=1"
              className="text-[11px] font-bold tracking-[0.16em] text-[#fff8ef] uppercase underline-offset-4 hover:underline"
            >
              Pay a batch instead →
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
