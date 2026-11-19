# Nod: step-by-step tasks

Companion to [`PLAN.md`](PLAN.md). One checklist per person.

**How to use**
- Tick a box (`- [x]`) when its "Done when" check passes. Commit the tick with the work.
- Priority tags follow the plan: **P0** single payment + receipt + banner → **P1** batch + MCP tool + demo vendor → **P2** PUSD → **P3** allowance contract → **P4** inbox, XO template bounty. When behind, cut from the bottom.
- Each step is sized for 1–3 hours. If one runs past 3 hours, say so in the team chat.
- **Deadline:** Nov 22, 19:30 IST (hard stop). **Submit by 15:00 IST.**

**Repo setup**
- The repo uses **npm workspaces** (not pnpm). From the root: `npm install`, then `npm test`.
- Person A's `packages/protocol` is being built first. B and C import everything from **`@nod/protocol`** (types such as `NodRequest`, `SignedNodRequest`, `SpendableUtxo`, `InputPath`, `ReceiptCheck`, and constants such as `MEMO_PREFIX_HEX`, `EXPLORER_TX_URL`, `CASHADDR_PREFIX`). Until a function lands, code against a local mock with the same signature (see Integration checkpoints).

---

## Person A — Protocol and chain (Aagneye)

Folders: `packages/protocol/src/`, `contracts/`, `docs/PROTOCOL.md`. Existing: `types.ts`, `constants.ts`.

### Nov 19

- [ ] **A1 · P0 · Request schema and canonical hash**
  Files: `packages/protocol/src/request.ts`, `packages/protocol/test/request.test.ts`
  zod schema for `NodRequest` (v=1, 32-hex `id`, 66-hex `agent`, cashaddr `vendor`, `SatsAmount | TokenAmount`, `purpose` ≤ `MAX_PURPOSE_LENGTH`, `expiry`, optional `buyer`); `canonicalize(req)` (sorted keys, no whitespace); `hashRequest(req)` = sha256 of canonical JSON (libauth).
  Done when: same request with keys in different order gives the same hash; invalid fields are rejected by zod.

- [ ] **A2 · P0 · Schnorr sign and verify**
  Files: `packages/protocol/src/request.ts`, `packages/protocol/test/request.test.ts`
  `signRequest(req, agentPrivKey) -> SignedNodRequest`, `verifyRequest(signed) -> boolean` (secp256k1 Schnorr over the 32-byte hash, pubkey from `req.agent`).
  Done when: valid sig verifies; changing any field (amount, vendor, purpose) makes verify fail.

- [ ] **A3 · P0 · Link encode/decode and `createRequest`**
  Files: `packages/protocol/src/request.ts`, `packages/protocol/test/request.test.ts`
  base64url of `{req, sig}`; `createRequest(fields, agentPrivKey) -> { req, sig }` plus `buildRequestUrl(baseUrl, signed)` (fills `v`, random `id`, `agent`); `decodeLink(payload) -> { signed, valid, expired }` (throws on a malformed payload; a well-formed request with a bad signature gives `valid:false`).
  Done when: round-trip test passes; garbage payload throws; bad signature gives `valid:false`; past `expiry` gives `expired:true`.

- [ ] **A4 · P0 · Electrum client**
  Files: `packages/protocol/src/electrum.ts`
  Using `@electrum-cash/network` and `ELECTRUM_SERVERS[network]`: `getUtxos(address)`, `getHistory(address)`, `getTx(txid)` (raw hex), `broadcast(txHex)`; returns `Utxo` with token data when present.
  Done when: a small script lists UTXOs and history for a funded Chipnet address and fetches one tx.

- [ ] **A5 · P0 · First exports for B and C**
  Files: `packages/protocol/src/index.ts`
  Export types, constants, request functions, electrum functions; add stubs for `buildPayment`, `findPayment`, `verifyReceipt` that throw "not implemented" with the final signatures.
  Done when: `import { createRequest, decodeLink } from '@nod/protocol'` works from `apps/web` and `packages/agent`; `npm test` is green.

### Nov 20

- [ ] **A6 · P0 · Memo builder**
  Files: `packages/protocol/src/memo.ts`, `packages/protocol/test/memo.test.ts`
  `encodeMemo(kind, hash)`: `OP_RETURN` + push `MEMO_PREFIX_HEX` ("NOD") + push kind byte (`MEMO_KIND_SINGLE` or `MEMO_KIND_BATCH`) + push 32-byte hash. Batch hash = `hashBatch` (sha256 of the sorted request hashes concatenated). Plus `decodeMemo(lockingBytecode) -> { kind, hash } | null`.
  Done when: build then parse returns the same kind and hash; output stays under 223 bytes.

- [ ] **A7 · P0 · Single payment tx**
  Files: `packages/protocol/src/tx.ts`, `packages/protocol/test/tx.test.ts`
  `buildPayment({ requests, utxos, changeAddress }) -> { txHex, sourceOutputs, inputPaths }` for one BCH request: coin selection from `SpendableUtxo[]`, vendor output, memo output, change (dropped if below `DUST_SATS`), fee at `FEE_SATS_PER_BYTE`. Match `sourceOutputs` to the shape in `@wizardconnect/dapp` types; `inputPaths` as `InputPath[]`.
  Done when: unit test decodes the tx and finds vendor output = requested sats, memo hash = request hash, inputs ≥ outputs + fee; rejects expired requests and insufficient funds.

- [ ] **A8 · P0 · Receipt check and paid check**
  Files: `packages/protocol/src/receipt.ts`, `packages/protocol/test/receipt.test.ts`
  `verifyReceipt(txid, req) -> ReceiptCheck` (fetch tx, check vendor output amount, memo hash, reasons list); `findPayment(req) -> { txid } | null` (scan vendor history for a tx committing this hash).
  Done when: test with a fixture tx passes; wrong amount / wrong hash / wrong vendor each give `ok:false` with a clear reason; `findPayment` finds a real Chipnet payment.

- [ ] **A9 · P1 · Batch payment**
  Files: `packages/protocol/src/tx.ts`, `packages/protocol/src/receipt.ts`, tests
  `buildPayment` with up to `MAX_BATCH` requests: one output per request, one batch memo; `verifyReceipt` accepts a batch tx when given the request (and its batch siblings or the batch hash).
  Done when: 3-request batch test passes build and verify; >`MAX_BATCH` is rejected.

- [ ] **A10 · P0 · Pair with B on first Chipnet payment**
  Files: none new (fixes in `tx.ts` as needed)
  Done when: a tx built by `buildPayment` is signed by a real wallet via WizardConnect and confirms on Chipnet.

### Nov 21

- [ ] **A11 · P2 · PUSD token outputs**
  Files: `packages/protocol/src/constants.ts` (fill `PUSD.category`, `decimals`), `packages/protocol/src/tx.ts`, `packages/protocol/src/receipt.ts`, tests
  Token request → vendor output with `TOKEN_OUTPUT_SATS` and token amount; token change back to buyer; receipt checks token category and units.
  Done when: unit test for a token payment passes; one real PUSD (or test token) payment verifies on chain.

- [ ] **A12 · P1 · Protocol doc**
  Files: `docs/PROTOCOL.md`
  Request fields, canonical JSON, hash, signature, link format, memo layout (`NOD` + kind + hash), batch hash rule, paid check.
  Done when: someone outside the team could build a compatible agent from the doc alone.

- [ ] **A13 · P3 · Allowance contract (stretch, only if P0–P2 are done)**
  Files: `contracts/allowance.cash`, `contracts/allowance.test.ts`
  `Allowance(ownerPkh, agentPk, vendorPkh, capSats, periodBlocks)` with `agentSpend(sig)` and `ownerWithdraw(walletInputIndex)` as in the plan.
  Done when: CashScript tests pass for: agent spend within cap, over cap fails, too early fails, owner withdraw works, owner withdraw to another address fails.

### Nov 22

- [ ] **A14 · P0 · Bug fixes only**
  Done when: `npm test` green on `main`; no open protocol bugs from the end-to-end runs.

---

## Person B — Web app

Folder: `apps/web/src/`. Import all protocol logic from `@nod/protocol`.

### Nov 19

- [ ] **B1 · P0 · Scaffold**
  Files: `apps/web/` (Vite + React + TS + Tailwind), `apps/web/src/main.tsx`, `apps/web/src/App.tsx` (routes `/`, `/r`, `/batch`, `/tx/:txid`)
  Done when: `npm run dev -w apps/web` serves the four routes with placeholder pages; `@nod/protocol` imports compile.

- [ ] **B2 · P0 · Banner (hackathon rule)**
  Files: `apps/web/src/components/Banner.tsx`
  Top-of-page bar on every route: link to slides (Widget Factory deck), link to public repo, the CashTokens address for **EMBER2026** votes (with copy button).
  Done when: banner shows on all routes at phone and desktop width; all three items work.

- [ ] **B3 · P0 · WizardConnect connect (biggest risk, do early)**
  Files: `apps/web/src/wallet/wizard.ts`, `apps/web/src/components/WalletButton.tsx`, `apps/web/src/main.tsx` (provider)
  Use `@wizardconnect/react`: `useWizardConnect`, `WizardConnectQRDialog`. Read the `@wizardconnect/dapp` types first (especially `sourceOutputs`). Get buyer addresses from `manager.getPubkey(0, 0n)` and derive the cashaddr (`bchtest:` on Chipnet).
  Done when: on **Chipnet**, Paytaca or Cashonize scans the QR, connects, and the app shows the wallet's address.

- [ ] **B4 · P0 · Sign and broadcast on Chipnet**
  Files: `apps/web/src/wallet/wizard.ts`
  `signAndBroadcast({ txHex, sourceOutputs, inputPaths, userPrompt })` calling
  `manager.signTransaction({ transaction: { transaction: txHex, sourceOutputs, userPrompt, broadcast: true }, inputPaths })`. Use a hand-built or mock tx until A7 lands.
  Done when: one Chipnet tx is approved on the phone and its txid appears in the app.

### Nov 20

- [ ] **B5 · P0 · Approval page**
  Files: `apps/web/src/pages/Request.tsx`, `apps/web/src/components/RequestCard.tsx`
  Read `#payload`, `decodeLink`, show agent name, vendor, amount, purpose, expiry countdown, "signature valid" badge; block if invalid, expired, or `findPayment` finds it already paid. **Nod** button → `getUtxos` → `buildPayment` → `signAndBroadcast` → go to `/tx/:txid`.
  Done when: a CLI-made Chipnet link is approved end-to-end from this page.

- [ ] **B6 · P0 · Receipt page**
  Files: `apps/web/src/pages/Receipt.tsx`, `apps/web/src/components/ReceiptCard.tsx`
  Shows txid, explorer link (`EXPLORER_TX_URL`), result of `verifyReceipt` ("request matches payment" or reasons), and the delivered item from `api/vendor/buy` when available.
  Done when: reloading `/tx/:txid` for a real tx shows OK; a tampered request shows the failure reasons.

- [ ] **B7 · P0 · Home page and demo button**
  Files: `apps/web/src/pages/Home.tsx`, `apps/web/src/lib/api.ts`
  One-line pitch, **"Ask the agent to buy something"** → calls `api/demo-agent` → navigates to the returned link.
  Done when: a judge on a fresh browser reaches the approval page in one tap.

- [ ] **B8 · P0 · Switch to mainnet**
  Files: `apps/web/src/wallet/wizard.ts`, env config (`VITE_NETWORK`)
  Done when: same flow works with a ~$0.01 mainnet request (with C, see Integration checkpoints).

### Nov 21

- [ ] **B9 · P1 · Batch page**
  Files: `apps/web/src/pages/Batch.tsx`
  Several request links → list with total → one approval → one tx with batch memo → receipt.
  Done when: a 3-request Chipnet batch is approved in one wallet prompt and each request verifies.

- [ ] **B10 · P1 · Fallback QR**
  Files: `apps/web/src/components/FallbackQR.tsx`, `apps/web/src/pages/Request.tsx`
  For wallets without WizardConnect: plain `bitcoincash:<vendor>?amount=<bch>` QR; poll vendor address and match by address + amount; label it "no memo, matched by amount".
  Done when: paying the QR from a normal wallet moves the page to a receipt.

- [ ] **B11 · P1 · Mobile polish, loading and error states**
  Files: `apps/web/src/pages/*`, `apps/web/src/components/*`
  Spinners for connect/sign/broadcast, clear errors (wallet rejected, not enough funds, expired, already paid), 375px layout, no horizontal scroll.
  Done when: full demo works on a phone browser with no layout breaks; each error case shows a readable message.

- [ ] **B12 · P3 · Allowance page (stretch)**
  Files: `apps/web/src/pages/Allowance.tsx`
  Done when: owner can fund and cancel an allowance on Chipnet (needs A13).

### Nov 22

- [ ] **B13 · P0 · Bug fixes only**
  Done when: demo passes on a fresh phone and browser in under 2 minutes, on mainnet.

---

## Person C — Agent, demo and launch

Folders: `packages/agent/src/`, `api/`, submission material. Import from `@nod/protocol`.

### Nov 19

- [ ] **C1 · P0 · Register and confirm (today)**
  Register the team on DoraHacks (BCH BLAZE 2026, Mainnet track). Join https://t.me/bchblaze and post that Nod is a real project in progress. Ask which wallets judges use and whether they support WizardConnect.
  Done when: DoraHacks registration shows the team; Telegram confirmation message is posted (save the link).

- [ ] **C2 · P0 · Roll call fix**
  Look for a roll-call participant to join the team (Telegram, X), or join forces with a roll-call team.
  Done when: one person asked in Telegram and on X; result noted in team chat.

- [ ] **C3 · P0 · Repo and Vercel**
  Files: `vercel.json` (if needed), Vercel project settings
  Public repo, Vercel project pointing at `apps/web` build plus `api/` functions.
  Done when: a push to `main` deploys and the banner shows at the public URL.

- [ ] **C4 · P0 · Demo agent stub**
  Files: `api/demo-agent.ts`
  Returns a signed request link for a $0.01 item from the demo vendor, using `createRequest` (or a mock until A3 lands). Agent key from env `NOD_DEMO_AGENT_KEY`.
  Done when: `curl <app>/api/demo-agent` returns a link that opens the approval page.

### Nov 20

- [ ] **C5 · P1 · Agent keys and CLI**
  Files: `packages/agent/src/keys.ts`, `packages/agent/src/cli.ts`
  `keys.ts`: create/load agent key (file or env). `cli.ts`: `nod request --vendor --sats --purpose`, `nod status <id>`, `nod list`.
  Done when: CLI prints a working Chipnet link and later reports paid with txid.

- [ ] **C6 · P1 · MCP server**
  Files: `packages/agent/src/mcp.ts`
  `@modelcontextprotocol/sdk` stdio server with tools `create_request` (returns link), `check_status` (uses `findPayment` + `verifyReceipt`), `list_requests` (local log of created requests).
  Done when: added to Claude, "buy one weather call" returns a link, and after approval `check_status` reports paid.

- [ ] **C7 · P1 · Demo vendor**
  Files: `api/vendor/buy.ts`
  Takes `{ txid, req }` (or the link payload), runs `verifyReceipt`, returns the item (e.g. a weather report or joke) only if `ok`.
  Done when: valid txid returns the item; wrong txid or unpaid request returns an error.

- [ ] **C8 · P0 · First mainnet payment end-to-end (by tonight)**
  With A and B: fund a test wallet with a little BCH, run the demo flow on mainnet.
  Done when: mainnet txid on an explorer, receipt page OK, vendor releases the item.

### Nov 21

- [ ] **C9 · P1 · Slides (Widget Factory template)**
  Copy the template: https://docs.google.com/presentation/d/1Yfuk9CJkf4U9M_WukcELhumWgj3Ak6345Ewy8hSp-Hk/edit
  Problem, agent angle, 30-second demo, how it uses BCH (OP_RETURN receipts, WizardConnect, CashTokens), business model, team; credit Requisition as inspiration.
  Done when: deck is shared "anyone with link can view" and the banner links to it.

- [ ] **C10 · P1 · README**
  Files: `README.md`
  Pitch, live link, demo steps, architecture sketch, `npm install` / `npm test`, MCP setup, credit to Requisition.
  Done when: a new reader can run the demo and add the MCP server from the README alone.

- [ ] **C11 · P1 · Video draft (60–90 s)**
  Files: `docs/DEMO.md` (script)
  Screen + phone capture of: agent asks → approval page → Nod in wallet → receipt → item delivered. Include a Claude/MCP clip.
  Done when: draft under 90 s uploaded (unlisted) and shared with the team.

- [ ] **C12 · P1 · Social posts**
  X thread and Telegram post with the live link, short clip, EMBER2026 address.
  Done when: both posted; links saved for the submission.

- [ ] **C13 · P4 · Request inbox (optional)**
  Files: `api/inbox.ts`
  Upstash Redis: agent POSTs a signed request, app lists pending ones for a buyer.
  Done when: a request posted by the CLI shows up in the app without sharing a link.

### Nov 22

- [ ] **C14 · P0 · Final video**
  Done when: final 60–90 s video uploaded publicly and linked from README and slides.

- [ ] **C15 · P0 · DoraHacks submission (by 15:00 IST)**
  Live link, repo, slides, video, description leading with the agent angle, EMBER2026 address.
  Done when: submission is live on DoraHacks and every link opens in a private window.

---

## Integration checkpoints

### 1. Shared handshake (Nov 19, first hour, everyone)
Agree these and do not change them without telling the team:
```ts
createRequest(fields, agentPrivKey) -> { req, sig }   // buildRequestUrl(baseUrl, signed) -> link
decodeLink(payload) -> { signed, valid, expired }   // throws on malformed payload
buildPayment({ requests, utxos, changeAddress }) -> { txHex, sourceOutputs, inputPaths }
findPayment(req) -> { txid } | null
verifyReceipt(txid, req) -> { ok, reasons[] }   // ReceiptCheck
```
- [ ] Signatures exported (stubs ok) from `@nod/protocol` (A5).
- [ ] B and C have mocks with the same shapes.

### 2. First Chipnet end-to-end (target Nov 20 midday)
- [ ] CLI (C5) creates a request → link opens on approval page (B5).
- [ ] Nod → WizardConnect → Paytaca/Cashonize approves → tx broadcast (A7, B4).
- [ ] Receipt page shows "request matches payment" (A8, B6).
- [ ] `nod status` reports paid.

### 3. First mainnet end-to-end (target Nov 20 night)
- [ ] Home → "Ask the agent to buy something" → approve ~$0.01 on mainnet.
- [ ] txid visible on `explorer.bch.ninja`.
- [ ] Demo vendor (C7) releases the item.
- [ ] MCP in Claude: "buy one weather call" → link → paid.

### 4. Submission checklist (Nov 22, before 15:00 IST)
- [ ] Banner on live site: slides link, repo link, EMBER2026 address all work.
- [ ] Slides use the Widget Factory template.
- [ ] Repo is public; README credits Requisition.
- [ ] Demo works on a fresh phone + browser in under 2 minutes, on mainnet.
- [ ] `npm test` green.
- [ ] Telegram "project is real" confirmation done.
- [ ] Video (60–90 s) public and linked.
- [ ] DoraHacks submission live; X and Telegram posts out.
