# Nod submission kit

Copy-paste text for DoraHacks, the Widget Factory slides, X and Telegram, plus the final checklist.
Live demo: https://nod-bch.vercel.app (Chipnet until the mainnet switch). Fill these placeholders everywhere before posting: `<VIDEO_URL>`, `<SLIDES_URL>`, `<MAINNET_TXID>`, `<EMBER2026_ADDRESS>`, `<TEAM>`.

Repo: https://github.com/aagneye/nod

## DoraHacks BUIDL

**Name:** Nod

**Tagline:** Your agent asks. You nod. BCH settles.

**Short description (one line):** The approval and payment layer for AI agents on Bitcoin Cash. Agents sign payment requests, humans approve with one tap in their own wallet, and every payment carries an on-chain receipt tied to the exact request.

**Description:**

> Nod is not another AI agent. It is the approval and payment layer any agent can use.
>
> **The problem.** AI agents are starting to pay for API calls, data and digital goods. Today you either give the agent a funded wallet, where one prompt injection or bug can drain it, or you pay by hand, and then nothing links the payment to what the agent actually asked for.
>
> **How Nod works.**
> 1. **The agent asks.** It signs a small Nod Request (vendor, amount, purpose, expiry) with a key that holds no money, and hands you a link. Claude and other agents do this through our MCP server; scripts use the `nod-agent` CLI.
> 2. **You nod.** The link opens an approval page that checks the signature, the expiry and whether it was already paid. You approve with one tap in your own wallet over WizardConnect (Paytaca, Selene). Several requests can be approved in one batch.
> 3. **BCH settles.** One mainnet transaction pays the vendor directly and carries an `OP_RETURN "NOD"` memo with the hash of the signed request. The agent, the vendor and you can each prove on-chain that this exact request was paid, with no server or database. Our demo vendor checks that receipt and then delivers the item.
>
> **Bitcoin Cash features used:** fast, cheap mainnet payments; OP_RETURN memos as receipts; Schnorr signatures (libauth); batch payments with many outputs in one transaction; CashTokens amounts in the protocol (PUSD-ready); public Fulcrum/Electrum servers; WizardConnect wallet connection; and an optional CashScript allowance covenant ("up to X sats per N blocks to this vendor, cancel any time").
>
> **Try it:** https://nod-bch.vercel.app, then click "Try the demo" and approve about $0.01 with Paytaca or Selene. Example mainnet payment: `<MAINNET_TXID>`.
>
> **Open protocol:** the request format, hashing, link encoding and memo are specified in `docs/PROTOCOL.md`, so any wallet, agent framework or vendor can implement Nod.
>
> **Inspiration:** [Requisition](https://dorahacks.io/build/50833) (agents request purchases, a human approves). Nod is a new codebase for Bitcoin Cash. It adds signed requests, on-chain receipts tied to the request, batch approval, an MCP/CLI agent tool and an allowance covenant.

**Links:** Live demo https://nod-bch.vercel.app · Video `<VIDEO_URL>` · Slides `<SLIDES_URL>` · GitHub https://github.com/aagneye/nod

**Tags:** Bitcoin Cash, AI agents, payments, MCP, WizardConnect, CashScript

**Track:** Mainnet

## Widget Factory slides

Copy the Widget Factory template, keep its layout, and paste one block per slide. Share as "anyone with the link can view" and put the URL in `VITE_SLIDES_URL`.

**1. Title**
- Nod
- Your agent asks. You nod. BCH settles.
- The approval and payment layer for AI agents on Bitcoin Cash
- https://nod-bch.vercel.app · github.com/aagneye/nod · EMBER2026: `<EMBER2026_ADDRESS>`

**2. Problem**
- AI agents now buy API calls, data and compute.
- If you give an agent a wallet, one prompt injection can drain it.
- If you pay by hand, nothing links the payment to the request, so nobody can audit it.
- Vendors cannot tell which request a payment was for.

**3. Solution**
- Nod is not another agent. It is the layer between any agent and your wallet.
- The agent signs a request but never holds your keys or your money.
- You approve with one tap in your own wallet.
- The payment proves on-chain which request it paid.

**4. How it works**
- 1. The agent asks: a signed Nod Request (vendor, amount, purpose, expiry) as a link.
- 2. You nod: the approval page checks signature, expiry and replay; you approve in Paytaca or Selene via WizardConnect.
- 3. BCH settles: the vendor is paid directly, and an `OP_RETURN "NOD" <request hash>` memo is the receipt.
- The vendor checks the receipt and delivers. Batch: many requests, one approval, one transaction.

**5. Built on Bitcoin Cash**
- Mainnet payments costing a fraction of a cent, settled in seconds
- OP_RETURN memo receipts with no server state
- Schnorr-signed requests (libauth); public Fulcrum servers over Electrum
- Batch payouts in one transaction; CashTokens amounts (PUSD-ready)
- CashScript allowance covenant: up to X sats per N blocks, cancellable
- WizardConnect wallet connection

**6. Demo**
- Claude (via MCP) asks to buy a weather report, I tap Nod on my phone, the vendor delivers.
- Mainnet tx: `<MAINNET_TXID>`
- Video: `<VIDEO_URL>`

**7. Business model**
- Free open protocol; revenue comes from the hosted layer.
- Vendors: a small fee (for example 0.5%) on Nod-settled payments, plus a verified "accepts Nod" badge and receipt API.
- Teams: a paid inbox for approvals, policies and allowances (per-agent budgets, auto-approve under a limit) and audit export.
- Agent platforms: an SDK/MCP integration so their agents can pay in BCH without custody.

**8. Team**
- `<TEAM>`: protocol and chain, web app and wallet, agent tool and launch.
- Built during BCH BLAZE 2026.

**9. Roadmap**
- Now: single and batch approvals, receipts, MCP + CLI, demo vendor on mainnet.
- Next: PUSD stablecoin pricing, an allowance UI on top of the covenant, a request inbox with push notifications.
- Later: native Nod support in wallets, vendor SDK (Express/Next middleware for "402 → Nod"), and agent framework plugins.

**10. Thanks / links**
- Inspired by Requisition (dorahacks.io/build/50833)
- https://nod-bch.vercel.app · github.com/aagneye/nod · `<VIDEO_URL>`

## X thread (4 posts)

1/
AI agents are starting to buy things. But should an agent hold your money?

Nod: your agent asks. You nod. BCH settles. 🧵
Built for #BCHBLAZE2026 on Bitcoin Cash mainnet.
https://nod-bch.vercel.app

2/
Nod is not another agent. It's the approval layer any agent can use.

The agent signs a request (vendor, amount, purpose, expiry). You get a link, check it, and approve with one tap in your own wallet over WizardConnect. The agent never holds your keys.

3/
Every payment goes straight to the vendor and carries an on-chain receipt: an OP_RETURN "NOD" memo with the hash of the exact signed request.

The agent, the vendor and you can all verify it from the chain alone. Batch approvals too: many requests in one tx.

4/
Works with Claude today via our MCP server, or any script via the CLI. It's an open protocol.

Try it for about $0.01: https://nod-bch.vercel.app
Video: <VIDEO_URL>
Code: github.com/aagneye/nod

Inspired by Requisition. $BCH #BitcoinCash #AIagents

## Telegram (BLAZE group): "project is real"

> Hi all, Nod is real and live for BCH BLAZE 2026 (Mainnet track).
>
> **Nod: your agent asks. You nod. BCH settles.** AI agents sign payment requests, you approve with one tap in your own wallet (WizardConnect: Paytaca or Selene), and the BCH payment carries an OP_RETURN receipt tied to the exact request. It works with Claude via MCP.
>
> Live: https://nod-bch.vercel.app (click "Try the demo", about $0.01)
> Repo: https://github.com/aagneye/nod
> Slides: <SLIDES_URL> · Video: <VIDEO_URL>
> Mainnet tx: <MAINNET_TXID>
>
> Feedback welcome, and we're happy to team up with anyone from roll call.

## Final pre-submit checklist

Eligibility:
- [ ] Built on **Bitcoin Cash mainnet**; `VITE_NETWORK=mainnet` and `NOD_NETWORK=mainnet` on the deployed app
- [ ] A **useful mainnet transaction** any judge can make from the live app (demo purchase works end to end on a fresh phone + browser)
- [x] **Live demo** at a clickable public URL: https://nod-bch.vercel.app (Chipnet now; switch to mainnet before submitting)
- [ ] Wallet connection through **WizardConnect**
- [ ] **Top-of-page banner** with the slides link (Widget Factory template), repo link, and **EMBER2026 CashTokens address**
- [ ] Slides made from the **Widget Factory template**, shared "anyone with link can view"
- [ ] Repo **public**: https://github.com/aagneye/nod
- [ ] **Original work**, with Requisition credited in README and slides
- [ ] **"Project is real"** post in the BLAZE Telegram (save the message link)
- [ ] Roll call missed: posted on X and Telegram, asked to join a roll-call team

Content:
- [ ] Video (60–90 s) uploaded; link in README, slides and DoraHacks
- [ ] One real mainnet txid opened on the explorer and pasted above
- [ ] README placeholders replaced (`<VIDEO_URL>`, `<SLIDES_URL>`; the live URL is filled in)
- [ ] MCP snippet tested once in Claude Desktop or Claude Code against the live URL
- [ ] Every link opened in a private window (live app, slides, video, repo, explorer)

Submit:
- [ ] DoraHacks BUIDL created with the text above, track **Mainnet**, by **15:00 IST Nov 22** (hard deadline 19:30 IST)
- [ ] X thread posted; link saved
