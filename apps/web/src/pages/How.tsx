import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { REPO_URL } from '../config';
import allowanceSource from '../../../../contracts/src/allowance.cash?raw';

const BLOB = `${REPO_URL}/blob/main`;

const STEPS = [
  {
    n: '01',
    title: 'Your agent asks',
    body: 'The agent builds a Nod Request (vendor, amount, purpose, expiry) and signs it with its own Schnorr key. The whole request rides in a link fragment, so no server ever sees it.',
  },
  {
    n: '02',
    title: 'You nod',
    body: 'You open the link, Nod verifies the signature and checks it has not been paid or expired, and your own wallet asks you to approve over WizardConnect. One tap.',
  },
  {
    n: '03',
    title: 'BCH settles',
    body: 'Your wallet pays the vendor directly and the same transaction carries a 40-byte NOD memo committing the request hash. That is the receipt: anyone can check it on-chain.',
  },
] as const;

const MEMO = [
  { hex: '6a', label: 'OP_RETURN' },
  { hex: '03', label: 'push 3' },
  { hex: '4e4f44', label: '"NOD"' },
  { hex: '01', label: 'push 1' },
  { hex: '<kind>', label: '01 single · 02 batch' },
  { hex: '20', label: 'push 32' },
  { hex: '<hash>', label: 'sha256 of the request' },
] as const;

const WALKTHROUGH = [
  {
    fn: 'agentSpend(sig agentSig)',
    who: 'The agent, with no human in the loop',
    points: [
      'Must be signed by the agent key baked into the contract.',
      'this.age >= periodBlocks: the coin must have sat untouched for a full period (a relative timelock, OP_CHECKSEQUENCEVERIFY).',
      'Output 0 must pay the one approved vendor, and at most capSats.',
      'Output 1 must send the rest back to this same contract, minus at most 2,000 sats of fee. That fresh coin has age 0, so the clock restarts.',
      'No other inputs can be mixed in. The only extra output allowed is a zero-value OP_RETURN memo with no tokens, so nothing leaves to an address you did not approve.',
    ],
  },
  {
    fn: 'ownerWithdraw(int walletInputIndex)',
    who: 'You, any time, from your normal wallet',
    points: [
      'The transaction must also spend one coin from your own P2PKH address. Your wallet signs that coin over WizardConnect; the contract input itself needs no signature.',
      'Everything goes to your address in a single output, minus at most 5,000 sats of fee.',
      'No waiting period and no agent cooperation: the kill switch is always live.',
    ],
  },
] as const;

function Section({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-line py-10 sm:py-14">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:gap-12">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2 className="display mt-4 text-[clamp(1.8rem,4.5vw,2.6rem)]">{title}</h2>
        </div>
        <div className="min-w-0 space-y-5 text-[15px] leading-relaxed text-muted">{children}</div>
      </div>
    </section>
  );
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-bold tracking-[0.12em] text-ink uppercase underline decoration-accent decoration-2 underline-offset-4 hover:text-accent"
    >
      {children} ↗
    </a>
  );
}

export default function HowPage() {
  return (
    <article className="pb-6">
      <header className="py-8 sm:py-12">
        <span className="eyebrow">How it works</span>
        <h1 className="display mt-6 max-w-3xl text-[clamp(2.4rem,8vw,4.4rem)]">
          Agents ask. People approve. <em className="text-accent">Bitcoin Cash keeps the receipt.</em>
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted">
          Nod is the approval and payment layer for AI agents. The agent never holds your money or your keys; it
          only signs requests. You approve each one, or a batch, in the wallet you already use, and every payment
          leaves a verifiable trail on-chain.
        </p>
      </header>

      <ol className="grid border-[1.5px] border-ink bg-ink sm:grid-cols-3 sm:gap-[1.5px]" style={{ boxShadow: '6px 6px 0 var(--ink)' }}>
        {STEPS.map((s, i) => (
          <li key={s.n} className={`p-6 sm:p-7 ${i === 2 ? 'bg-acid text-[#171713]' : 'bg-panel'} ${i > 0 ? 'border-t-[1.5px] border-ink sm:border-t-0' : ''}`}>
            <span className={`step-num ${i === 2 ? '!text-[#171713]' : ''}`}>{s.n}</span>
            <h3 className="display mt-4 text-2xl">{s.title}</h3>
            <p className={`mt-3 text-sm leading-relaxed ${i === 2 ? 'text-[#3a3a30]' : 'text-muted'}`}>{s.body}</p>
          </li>
        ))}
      </ol>

      <div className="mt-12" />

      <Section eyebrow="On-chain" title="A 40-byte receipt">
        <p>
          Every Nod payment includes one zero-value <code className="text-ink">OP_RETURN</code> output. It commits
          the hash of the signed request, so a vendor (or anyone) can prove a specific request was paid by scanning
          the vendor's address history. No contract state, no server, no database.
        </p>
        <div className="card overflow-x-auto p-4 sm:p-5">
          <div className="flex min-w-max gap-2">
            {MEMO.map((m) => (
              <div key={m.hex + m.label} className="border border-line bg-bg px-3 py-2">
                <code className="block text-sm font-bold text-ink">{m.hex}</code>
                <span className="label mt-1 block !text-[9px]">{m.label}</span>
              </div>
            ))}
          </div>
        </div>
        <p>
          A payment matches a request only when the same transaction has both the exact vendor output and the memo.
          Over- or under-paying does not count.
        </p>
      </Section>

      <Section eyebrow="Custody" title="The agent never holds keys">
        <p>
          The agent's key can sign requests, nothing else. It cannot move a single satoshi of yours: the payment is
          built and signed by your wallet, after you see the vendor, amount, purpose and the agent's key
          fingerprint. Change any field and the signature breaks; requests expire, and Nod refuses to pay one twice.
        </p>
        <p>
          A leaked agent key lets someone send you requests you can ignore. A leaked link has a short life and pays
          a fixed vendor a fixed amount, once.
        </p>
      </Section>

      <Section eyebrow="Batch" title="Ten asks, one nod">
        <p>
          Agents that queue up many small purchases can be approved together. Nod pays every vendor in a single
          transaction and writes one batch memo (kind <code className="text-ink">02</code>):
        </p>
        <pre className="overflow-x-auto border border-line bg-panel p-4 text-xs text-ink">
          <code>batchHash = sha256(sort(h1, h2, …, hn) concatenated)</code>
        </pre>
        <p>
          Sorting makes the order irrelevant, up to 50 requests fit, and each one still has its own vendor output, so
          every request in the batch can be verified individually.
        </p>
      </Section>

      <Section
        eyebrow="BCH scripting"
        title={
          <>
            Allowance <em className="text-accent">covenant</em>
          </>
        }
      >
        <p>
          For small recurring spend, approving every call is friction. The allowance is a CashScript covenant: you
          fund it once, and the agent may pay <strong className="text-ink">one vendor</strong> up to{' '}
          <strong className="text-ink">a cap per period</strong> without asking. You can pull everything back at any
          time. The rules live in the coin itself, enforced by every BCH node.
        </p>
        <p>
          <span className="chip">Covenant built and tested · 11 tests</span>{' '}
          <span className="chip-plain chip">Wallet UI on the roadmap</span>
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          {WALKTHROUGH.map((w) => (
            <div key={w.fn} className="card p-5">
              <code className="block text-sm font-bold break-words text-ink">{w.fn}</code>
              <span className="label mt-2 block">{w.who}</span>
              <ul className="mt-4 space-y-2.5 text-sm">
                {w.points.map((p) => (
                  <li key={p} className="flex gap-2.5">
                    <span className="mt-[0.55em] inline-block size-1.5 shrink-0 bg-accent" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="band-inverse overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-white/15 px-4 py-2.5">
            <span className="text-[10px] font-bold tracking-[0.16em] text-[#f4f3ea]/70 uppercase">
              contracts/src/allowance.cash
            </span>
            <a
              href={`${BLOB}/contracts/src/allowance.cash`}
              target="_blank"
              rel="noreferrer"
              className="text-[10px] font-bold tracking-[0.16em] text-acid uppercase hover:underline"
            >
              View on GitHub ↗
            </a>
          </div>
          <pre className="max-h-[32rem] overflow-auto p-4 text-[12px] leading-relaxed text-[#f4f3ea]">
            <code>{allowanceSource.trim()}</code>
          </pre>
        </div>
      </Section>

      <Section eyebrow="Business" title="How it makes money">
        <p>
          The protocol is free and open. Revenue comes from the hosted layer: a small fee (around 0.5%) on
          Nod-settled vendor payments with a receipt API, and a paid team inbox for approval policies, allowances
          and audit export.
        </p>
      </Section>

      <Section eyebrow="Verify it yourself" title="Read the source">
        <div className="flex flex-wrap gap-x-7 gap-y-3">
          <Ext href={REPO_URL}>GitHub repo</Ext>
          <Ext href={`${BLOB}/docs/PROTOCOL.md`}>PROTOCOL.md</Ext>
          <Ext href={`${BLOB}/contracts/test/allowance.test.ts`}>Contract tests</Ext>
        </div>
        <p className="pt-2">
          <Link to="/" className="btn-cta">
            Try the demo <span aria-hidden>→</span>
          </Link>
        </p>
      </Section>
    </article>
  );
}
