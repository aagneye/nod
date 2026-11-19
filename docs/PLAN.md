# Nod — build plan for BCH BLAZE 2026

> *"Your agent asks. You nod. BCH settles."*

## Context

We are entering **BCH BLAZE 2026** (Mainnet track, deadline **Nov 22, 19:30 IST**; aim to submit by 15:00 IST).
The idea adapts [Requisition](https://dorahacks.io/build/50833) (AI agents request purchases, a human approves, money goes straight to the vendor) to Bitcoin Cash, and adds things Requisition lacks.
The name "Selene" was dropped because Selene Wallet is a sponsor and its lead developer is a judge; the project is called **Nod**.

Step-by-step tasks for each person are in [`docs/STEPS.md`](STEPS.md).

## What the hackathon requires (from the DoraHacks page)

| Rule | How Nod meets it |
|---|---|
| Built on **Bitcoin Cash mainnet** (not Ethereum/Base) | All payments are BCH mainnet transactions; Chipnet (BCH testnet) for testing |
| A useful mainnet transaction any judge can make in the app | Judge approves a ~$0.01 agent purchase and gets the purchased item |
| Live demo at a clickable link | Hosted on Vercel |
| **WizardConnect or XO Template** wallet connection | WizardConnect (`@wizardconnect/react`) |
| Top-of-page banner: slides (Widget Factory template), repo, CashTokens address for EMBER2026 votes | Banner component, done on day 1 |
| Confirm the project is real in the BLAZE Telegram | Person C, today |
| Roll call (missed) → low-priority queue | Person C: try to join a roll-call team / recruit a roll-call member; promote on X and Telegram |
| Original work | New repo; credit Requisition as inspiration in README and slides |

Judging: 3 judges × 4 areas × 10 points — cool, slick, works/uses BCH well, could make money. Judges spend ~2 minutes. **Simple and working beats complex and rough.**

## What we are building

**A web app plus a small open protocol plus an agent tool.** Not a mobile app (judges need a clickable link; the wallet on their phone is the mobile part).

1. **Nod Request (protocol)** — a small signed JSON message an agent creates: vendor, amount, purpose, expiry.
2. **Nod web app** — the person opens a link, sees the request, approves with their wallet, gets a receipt.
3. **Nod agent tool (MCP server + CLI)** — lets Claude or any agent create requests and check whether they were paid.
4. **Allowance contract (stretch)** — a CashScript covenant so the agent can spend small amounts on its own.

### The 30-second judge demo
1. Home page → **"Ask the agent to buy something"** (demo agent requests a $0.01 item from the demo vendor).
2. Approval page shows vendor, amount, purpose, expiry, "signature valid".
3. **Nod** button → WizardConnect QR → approve in Paytaca/Cashonize.
4. Receipt page: mainnet txid, explorer link, "request matches payment", and the delivered item.

## Architecture

```
Agent (Claude via MCP / CLI / demo agent)
   │  creates + signs Nod Request
   ▼
Link:  https://<app>/r#<base64url request>      (stateless; optional inbox via KV)
   ▼
Web app (React) ── verifies signature, expiry, not-already-paid
   │  builds unsigned tx (libauth)        ◄── UTXOs from Electrum/Fulcrum servers
   │  WizardConnect signTransaction({broadcast:true})  ◄──► phone wallet (Nostr relay, encrypted)
   ▼
BCH mainnet tx:  inputs = buyer coins
                 out 0..n = vendor(s)            (BCH, or PUSD CashTokens)
                 out n+1  = OP_RETURN "NOD" + hash of request(s)
                 out n+2  = change
   ▼
Receipt page ── re-fetches tx from chain, checks vendor+amount+OP_RETURN hash
Demo vendor API ── verifies the same receipt, releases the item to the agent
```

### Network and protocols
- **Chain:** Bitcoin Cash mainnet; Chipnet for testing (faucets: tbch.googol.cash, chipnet.bch.ninja).
- **Money:** BCH; **PUSD** (ParyonUSD, a CashToken — sponsor's stablecoin) as second option.
- **Wallet link:** WizardConnect (Nostr transport, no project ID). Wallets: Paytaca, Cashonize.
- **Chain data:** Electrum Cash protocol over WSS (public Fulcrum servers), via `@electrum-cash/network`.
- **Contracts:** CashScript (stretch feature only).
- **Agent link:** Model Context Protocol (stdio server).

### Nod Request v1
```json
{
  "v": 1,
  "id": "<16-byte random hex>",
  "agent": "<agent compressed pubkey hex>",
  "agentName": "research-bot",
  "vendor": "bitcoincash:q...",
  "amount": { "sats": 2500 }            // or { "token": "<category hex>", "units": "1000000" }
  ,"purpose": "1 call to weather API",
  "expiry": 1795400000,
  "buyer": "bitcoincash:q..."            // optional
}
```
- `hash = sha256(canonical JSON)` (sorted keys, no whitespace).
- `sig` = agent's secp256k1 Schnorr signature over `hash` (libauth).
- Link payload = base64url of `{req, sig}`.
- **On-chain memo:** `OP_RETURN "NOD" 0x01 <32-byte hash>`. For a batch: one hash = sha256 of the sorted request hashes (keeps under the 223-byte data limit).
- **Paid check (replay protection):** scan the vendor address history for a tx whose OP_RETURN commits this hash and whose output pays the right amount. No contract state needed.

### Known constraints found in research
- **WizardConnect only signs the wallet's own P2PKH coins**; it cannot sign inside a contract. So: normal approvals use plain P2PKH inputs (fine). For the allowance contract, the owner's "cancel" path uses the pattern from [Backstop PR #2](https://github.com/Emediong-Etuk/Backstop/pull/2): the owner includes one of their own coins as an input and the contract checks all outputs go to the owner.
- `sourceOutputs` shape is not documented — read the types in `@wizardconnect/dapp` first thing.
- Other BLAZE entries already do payment links and bill splitting (`bch-pay-links`, `bch-split`, `pot`). None targets AI agents. **Lead with the agent angle everywhere.**

### Allowance contract (stretch, P3)
`Allowance(ownerPkh, agentPk, vendorPkh, capSats, periodBlocks)`
- `agentSpend(sig)`: valid agent signature; `this.age >= periodBlocks`; output 0 pays `vendorPkh` at most `capSats`; output 1 returns the rest to the same contract.
- `ownerWithdraw(walletInputIndex)`: an input belongs to `ownerPkh`; all outputs pay `ownerPkh`; fee capped.
- Effect: "up to X per N blocks to this vendor, cancellable any time". Stateless, small, testable.

## Folder structure (npm workspaces, TypeScript)

```
nod/
├─ apps/web/                     Vite + React + Tailwind
│  └─ src/
│     ├─ pages/        Home.tsx, Request.tsx (/r), Batch.tsx, Receipt.tsx (/tx/:txid), Allowance.tsx
│     ├─ components/   Banner.tsx, WalletButton.tsx, RequestCard.tsx, ReceiptCard.tsx, FallbackQR.tsx
│     ├─ wallet/       wizard.ts (WizardConnect adapter: addresses, signAndBroadcast)
│     └─ lib/          api.ts
├─ packages/protocol/            shared core, no UI
│  └─ src/  request.ts (schema, canonicalize, hash, sign, verify, encode/decode)
│           electrum.ts (utxos, history, getTx, broadcast)
│           tx.ts (buildPayment: single, batch, token)
│           receipt.ts (verifyReceipt, findPayment)
│           constants.ts (PUSD category, servers, memo prefix)
├─ packages/agent/               MCP server + CLI
│  └─ src/  mcp.ts (tools: create_request, check_status, list_requests), cli.ts, keys.ts
├─ contracts/                    allowance.cash, allowance.test.ts (stretch)
├─ api/                          Vercel functions
│  ├─ demo-agent.ts              creates a signed demo request
│  ├─ vendor/buy.ts              demo vendor: verifies receipt, returns the item
│  └─ inbox.ts                   optional request inbox (Upstash Redis)
├─ docs/  PROTOCOL.md, DEMO.md
└─ README.md
```
Libraries: `@bitauth/libauth`, `@electrum-cash/network`, `@wizardconnect/{core,dapp,react}`, `cashscript` (stretch), `@modelcontextprotocol/sdk`, `zod`, `vitest`.

## Work split — three people

**Day-1 handshake (first hour, everyone):** agree the `packages/protocol` function signatures below so B and C can work against mocks.
```ts
createRequest(fields, agentPrivKey) -> { req, sig, link }
decodeLink(payload) -> { req, sig, valid, expired }
buildPayment({ requests, utxos, changeAddress }) -> { txHex, sourceOutputs, inputPaths }
findPayment(req) -> { txid } | null
verifyReceipt(txid, req) -> { ok, reasons[] }
```

### Person A — Protocol and chain (`packages/protocol`, `contracts/`) — **Aagneye**
- Request schema, canonical hash, sign/verify, link encoding + unit tests.
- Electrum client: UTXOs, address history, get tx, broadcast.
- Transaction builder: single payment → batch → PUSD token outputs.
- Receipt verification and paid-check.
- Stretch: allowance contract + tests.

### Person B — Web app (`apps/web`)
- Scaffold, design system, **Banner** (slides, repo, EMBER2026 address).
- WizardConnect connect + sign flow (test on Chipnet in the first hours — biggest risk).
- Request approval page, batch page, receipt page.
- Fallback: plain `bitcoincash:` payment QR for wallets without WizardConnect (receipt matched by address + amount).
- Mobile layout, error states, loading states. Stretch: allowance page.

### Person C — Agent, demo and launch (`packages/agent`, `api/`, submission)
- **Today:** register on DoraHacks, join Telegram, confirm project is real, look for a roll-call teammate.
- MCP server + CLI (`create_request`, `check_status`).
- Demo agent and demo vendor endpoints; Vercel deploy; Upstash inbox (optional).
- Widget Factory slides, README, 60–90s demo video, DoraHacks submission.
- X and Telegram posts (for Community Choice and to escape the low-priority queue).

## Schedule (IST)

| When | A | B | C |
|---|---|---|---|
| **Nov 19** | Request format + signing; Electrum client | Scaffold, banner, WizardConnect on Chipnet | Register, Telegram, repo, Vercel, demo-agent stub |
| **Nov 20** | Tx builder (single + batch), receipt verify | Approval + receipt pages wired to real txs | MCP server, demo vendor; **first mainnet payment end-to-end by night** |
| **Nov 21** | PUSD; allowance contract if on track | Batch page, fallback QR, polish, mobile | Slides, README, video draft, social posts |
| **Nov 22** | Bug fixes only | Bug fixes only | Final video, submit by **15:00**, hard stop 19:30 |

**Priorities (cut from the bottom):** P0 single payment + receipt + banner → P1 batch + MCP tool + demo vendor → P2 PUSD → P3 allowance contract → P4 inbox, XO template bounty.

## Verification

- `npm test` — protocol unit tests: hash is stable, tampered request fails, expired request rejected, tx outputs match requests, receipt check passes/fails correctly.
- **Chipnet end-to-end:** create request via CLI → open link → approve in Paytaca/Cashonize → receipt page shows OK.
- **Mainnet end-to-end** (tiny amounts): same flow; confirm txid on a block explorer; demo vendor releases the item.
- **MCP check:** add the server to Claude, ask it to "buy one weather call", confirm it returns a link and later reports paid.
- **Rules checklist before submitting:** banner links work; slides use the Widget Factory template; repo public; EMBER2026 address shown; demo works on a fresh phone and browser in under 2 minutes; Telegram confirmation done.

## Open items to confirm on day 1
- PUSD token category ID and decimals (from paryonusd.com / ParyonUSD Telegram).
- Which wallets the judges use and whether they support WizardConnect (ask in BLAZE Telegram).
- Working public WizardConnect relays and Fulcrum WSS servers for mainnet and Chipnet.
