import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { REPO_BLOB_URL, REPO_URL } from '../config';
import nodReceiptsSource from '../../../../contracts/contracts/NodReceipts.sol?raw';
import nodPolicySource from '../../../../contracts/contracts/NodPolicy.sol?raw';

const STEPS = [
  {
    n: '01',
    title: 'Your agent asks',
    body: 'The agent signs payment terms with EIP-712: merchant, recipient, amount in USD, purpose, expiry. The signed terms ride in a link fragment, so no server has to store them.',
  },
  {
    n: '02',
    title: 'You nod',
    body: 'Nod checks the signature and expiry in your browser, asks HSP for a quote, shows you the exact token amount, and your own wallet signs one payment authorization.',
  },
  {
    n: '03',
    title: 'HSK Chain settles',
    body: "HSP's Gateway executes the transfer. Nod checks it on chain and anchors the receipt in NodReceipts on HSK Chain, linking the terms to the settlement for good.",
  },
] as const;

/** The plain-language version: what happens, from the payer's seat. */
const WALKTHROUGH = [
  'An agent you use wants to buy something, say a weather report from another agent. Instead of holding money, it sends you a link with its signed terms.',
  'You open the link. Nod shows who is asking, how much, for what, who gets paid and when the offer ends, and confirms the agent really signed it and nobody changed a word.',
  'You press Nod. Your wallet (OKX Wallet, MetaMask or any other) connects, and Nod asks HSP how much of which token that costs. You see the quote before anything else.',
  'You sign once in your wallet. That signature is a permission slip for this one transfer, not a blank cheque, and it expires in minutes.',
  'HSP carries out the transfer. Nod shows every step until HSP reports it safe, then checks the transfer on chain itself.',
  'Nod writes a receipt on HSK Chain saying these terms were paid by that transaction. The selling agent sees it and delivers. Anyone can verify it later.',
] as const;

/** HSP Agentic Payment, in the order Nod calls it (PROTOCOL §2). */
const HSP_STEPS = [
  {
    tool: 'create_order',
    who: 'Nod server',
    text: 'Turns the signed terms into an HSP cart: merchant, pay_to, the USD amount and an expiry. HSP returns a flow id and a payment request id.',
  },
  {
    tool: 'prepare_payment',
    who: 'Nod server',
    text: 'For your wallet address, HSP picks the token amount and returns an EIP-712 authorization to sign. The quote lasts about 5 minutes.',
  },
  {
    tool: 'wallet signature',
    who: 'You',
    text: "Your wallet switches to the chain in HSP's EIP-712 domain and signs the authorization exactly as HSP built it (eth_signTypedData_v4). It is not a transaction.",
  },
  {
    tool: 'finalize_payment',
    who: 'Nod server',
    text: 'Hands your signature back to HSP with the opaque payload from prepare_payment. HSP wraps it into a payment mandate.',
  },
  {
    tool: 'submit_payment',
    who: 'Nod server',
    text: "Submits the mandate unchanged. HSP's Gateway broadcasts the token transfer from your wallet to the merchant.",
  },
  {
    tool: 'query_payment',
    who: 'Nod server',
    text: 'The app asks every 3 seconds and the server relays HSP’s answer: submitted, verified, processing, included, then safe or finalized (paid), or failed with a reason.',
  },
] as const;

const TERMS_TYPE = `// EIP-712, domain { name: "Nod", version: "2" } (no chainId: terms are network-independent)
Terms(
  uint8   v,          // 2
  bytes16 id,         // random per request
  string  merchant,   // shown to the payer
  address payTo,      // who gets paid
  string  amountUsd,  // "0.10"
  string  purpose,    // "1 live weather report"
  uint64  expiry,     // unix seconds
  address agent       // the key that signed
)
termsHash = hashTypedData(domain, Terms, terms)   // bytes32, anchored in NodReceipts`;

const RECEIPT_FUNCTIONS = [
  {
    fn: 'anchor(termsHash, settlementTx, chainId, payer, payTo, amount)',
    who: 'A recorder: the Nod server or the vendor',
    points: [
      'Called after the server has checked the ERC-20 Transfer on the payment network: right token, from the payer, to terms.payTo, at least the amount asked.',
      'Stores which settlement transaction (and on which chain) paid which terms, plus the block time.',
      'Receipts are namespaced by recorder (msg.sender): nobody can block or overwrite someone else’s receipt, and each recorder anchors a given termsHash once.',
    ],
  },
  {
    fn: 'receiptOf(recorder, termsHash) · isAnchored(recorder, termsHash)',
    who: 'Anyone: the vendor, the payer, an auditor',
    points: [
      'A request counts as paid once a recorder you trust has anchored it.',
      'Nod checks it before creating a new HSP order, so the same terms are not paid twice.',
      'anchorBatch records many receipts in one transaction.',
    ],
  },
] as const;

const POLICY_FUNCTIONS = [
  {
    fn: 'setPolicy · allowPayee · revoke',
    who: 'You, the owner, from your own wallet',
    points: [
      'Approve NodPolicy for an ERC-20 token; the funds stay in your wallet.',
      'setPolicy(agent, token, cap, period): the most this agent may spend per period, in that token.',
      'allowPayee(agent, payee, true) for each recipient the agent may pay. revoke(agent, token) stops it at once; so does removing the token approval.',
    ],
  },
  {
    fn: 'pay(owner, token, payee, amount, termsHash)',
    who: 'The agent, with no human in the loop',
    points: [
      'Requires an active policy, an allowed payee and spent + amount within the cap for the current period.',
      'A new period starts once block.timestamp reaches periodStart + period.',
      'Moves tokens with SafeERC20.safeTransferFrom(owner, payee, amount) and emits PolicyPaid with the termsHash it paid.',
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

function FunctionCards({
  items,
}: {
  items: ReadonlyArray<{ fn: string; who: string; points: readonly string[] }>;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {items.map((w) => (
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
  );
}

/** Solidity source in the inverse code panel, straight from contracts/ at build time. */
function SourcePanel({ path, source }: { path: string; source: string }) {
  return (
    <div className="band-inverse overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-white/15 px-4 py-2.5">
        <span className="min-w-0 truncate text-[10px] font-bold tracking-[0.16em] text-[#f4f3ea]/70 uppercase">{path}</span>
        <a
          href={`${REPO_BLOB_URL}/${path}`}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-[10px] font-bold tracking-[0.16em] text-acid uppercase hover:underline"
        >
          View on GitHub ↗
        </a>
      </div>
      <pre className="max-h-[32rem] overflow-auto p-4 text-[12px] leading-relaxed text-[#f4f3ea]">
        <code>{source.trim()}</code>
      </pre>
    </div>
  );
}

export default function HowPage() {
  return (
    <article className="pb-6">
      <header className="py-8 sm:py-12">
        <span className="eyebrow">How it works</span>
        <h1 className="display mt-6 max-w-3xl text-[clamp(2.4rem,8vw,4.4rem)]">
          Agents ask. People approve. <em className="text-accent">HSK Chain keeps the receipt.</em>
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted">
          Nod is the approval and settlement layer for AI agent payments on HSK Chain. The agent never holds your money
          or your keys; it only signs terms. You approve each payment in the wallet you already use, HSP (the HashKey
          Settlement Platform) executes it, and every payment ends with a receipt anchored on HSK Chain.
        </p>
      </header>

      <ol
        className="grid border-[1.5px] border-ink bg-ink sm:grid-cols-3 sm:gap-[1.5px]"
        style={{ boxShadow: '6px 6px 0 var(--ink)' }}
      >
        {STEPS.map((s, i) => (
          <li
            key={s.n}
            className={`p-6 sm:p-7 ${i === 2 ? 'bg-acid text-[#171713]' : 'bg-panel'} ${i > 0 ? 'border-t-[1.5px] border-ink sm:border-t-0' : ''}`}
          >
            <span className={`step-num ${i === 2 ? '!text-[#171713]' : ''}`}>{s.n}</span>
            <h3 className="display mt-4 text-2xl">{s.title}</h3>
            <p className={`mt-3 text-sm leading-relaxed ${i === 2 ? 'text-[#3a3a30]' : 'text-muted'}`}>{s.body}</p>
          </li>
        ))}
      </ol>

      <div className="mt-12" />

      <Section eyebrow="In plain words" title="What happens when you nod">
        <ol className="space-y-3">
          {WALKTHROUGH.map((line, i) => (
            <li key={line} className="flex gap-4">
              <span className="step-num shrink-0 pt-0.5">{String(i + 1).padStart(2, '0')}</span>
              <span>{line}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Section eyebrow="The ask" title="Signed terms">
        <p>
          Terms are typed data, signed by the agent's key with EIP-712. Change any field and the signature no longer
          recovers to the agent; let the expiry pass and Nod refuses to pay. The terms hash is what the receipt on HSK
          Chain points back to.
        </p>
        <pre className="overflow-x-auto border border-line bg-panel p-4 text-xs leading-relaxed text-ink">
          <code>{TERMS_TYPE}</code>
        </pre>
        <p>
          A link is <code className="text-ink">/r#&lt;payload&gt;</code>, the base64url JSON of the signed terms. The
          fragment never reaches a server, and the same link verifies in any browser.
        </p>
      </Section>

      <Section
        eyebrow="Settlement"
        title={
          <>
            Executed through <em className="text-accent">HSP</em>
          </>
        }
      >
        <p>
          Every approved payment runs through HSP Agentic Payment. Nod's server is an MCP client of HSP; it never builds
          payment JSON, JWTs or hashes itself. HSP's tools do, and your wallet signs what HSP returns, unchanged.
        </p>
        <ol className="grid gap-px border-[1.5px] border-ink bg-ink sm:grid-cols-2">
          {HSP_STEPS.map((step, i) => (
            <li key={step.tool} className={`p-5 ${step.who === 'You' ? 'bg-acid text-[#171713]' : 'bg-panel'}`}>
              <div className="flex items-center justify-between gap-3">
                <span className={`step-num ${step.who === 'You' ? '!text-[#171713]' : ''}`}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span
                  className={`text-[9px] font-bold tracking-[0.16em] uppercase ${step.who === 'You' ? 'text-[#3a3a30]' : 'text-faint'}`}
                >
                  {step.who}
                </span>
              </div>
              <code className="mt-3 block text-sm font-bold">{step.tool}</code>
              <p className={`mt-2 text-sm leading-relaxed ${step.who === 'You' ? 'text-[#3a3a30]' : 'text-muted'}`}>
                {step.text}
              </p>
            </li>
          ))}
        </ol>
        <p>
          An expired quote (HSP Gateway code 30043) means a new <code className="text-ink">prepare_payment</code> and a
          new signature; the app does that for you. HSP only accepts calls from allowlisted IPs, which is why the
          payment routes run on a server with a fixed address.
        </p>
      </Section>

      <Section
        eyebrow="Receipt"
        title={
          <>
            <em className="text-accent">NodReceipts</em> on HSK Chain
          </>
        }
      >
        <p>
          HSP's transfer cannot carry Nod data, so after HSP reports the payment safe, the server checks the token
          transfer on chain and records <code className="text-ink">termsHash → settlement</code> in NodReceipts. That
          receipt is what the vendor trusts before it delivers, and what stops the same terms being paid twice.
        </p>
        <FunctionCards items={RECEIPT_FUNCTIONS} />
        <SourcePanel path="contracts/contracts/NodReceipts.sol" source={nodReceiptsSource} />
      </Section>

      <Section
        eyebrow="Without a nod"
        title={
          <>
            <em className="text-accent">NodPolicy</em> spending caps
          </>
        }
      >
        <p>
          Approving every small call is friction. NodPolicy lets you give an agent a cap per period, in one token, for
          payees you choose. The agent then pays directly within those limits, and you can revoke it at any time. Funds
          never leave your wallet until a payment happens.
        </p>
        <FunctionCards items={POLICY_FUNCTIONS} />
        <SourcePanel path="contracts/contracts/NodPolicy.sol" source={nodPolicySource} />
      </Section>

      <Section eyebrow="Custody" title="The agent never holds keys">
        <p>
          The agent's key can sign terms, nothing else. It cannot move your tokens: HSP only executes a transfer your
          wallet authorized, after you saw the merchant, amount, recipient and HSP's quote. A leaked agent key lets
          someone send you terms you can ignore; a leaked link pays a fixed recipient a fixed amount, once, before it
          expires.
        </p>
      </Section>

      <Section eyebrow="Business" title="How it makes money">
        <p>
          The protocol is free and open. Revenue comes from the hosted layer: a small fee on Nod-settled payments with a
          receipt API for vendors, and a paid team console for spending policies, approvals and audit export.
        </p>
      </Section>

      <Section eyebrow="Verify it yourself" title="Read the source">
        <div className="flex flex-wrap gap-x-7 gap-y-3">
          <Ext href={REPO_URL}>GitHub repo</Ext>
          <Ext href={`${REPO_BLOB_URL}/docs/PROTOCOL.md`}>PROTOCOL.md</Ext>
          <Ext href={`${REPO_BLOB_URL}/contracts/test/NodReceipts.test.ts`}>NodReceipts tests</Ext>
          <Ext href={`${REPO_BLOB_URL}/contracts/test/NodPolicy.test.ts`}>NodPolicy tests</Ext>
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
