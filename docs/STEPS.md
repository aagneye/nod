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

- [x] **A1 · P0 · Request schema and canonical hash**
  Files: `packages/protocol/src/request.ts`, `packages/protocol/test/request.test.ts`
  zod schema for `NodRequest` (v=1, 32-hex `id`, 66-hex `agent`, cashaddr `vendor`, `SatsAmount | TokenAmount`, `purpose` ≤ `MAX_PURPOSE_LENGTH`, `expiry`, optional `buyer`); `canonicalize(req)` (sorted keys, no whitespace); `hashRequest(req)` = sha256 of canonical JSON (libauth).
  Done when: same request with keys in different order gives the same hash; invalid fields are rejected by zod.

- [x] **A2 · P0 · Schnorr sign and verify**
  Files: `packages/protocol/src/request.ts`, `packages/protocol/test/request.test.ts`
  `signRequest(req, agentPrivKey) -> SignedNodRequest`, `verifyRequest(signed) -> boolean` (secp256k1 Schnorr over the 32-byte hash, pubkey from `req.agent`).
  Done when: valid sig verifies; changing any field (amount, vendor, purpose) makes verify fail.

- [x] **A3 · P0 · Link encode/decode and `createRequest`**
  Files: `packages/protocol/src/request.ts`, `packages/protocol/test/request.test.ts`
  base64url of `{req, sig}`; `createRequest(fields, agentPrivKey) -> { req, sig }` plus `buildRequestUrl(baseUrl, signed)` (fills `v`, random `id`, `agent`); `decodeLink(payload) -> { signed, valid, expired }` (throws on a malformed payload; a well-formed request with a bad signature gives `valid:false`).
  Done when: round-trip test passes; garbage payload throws; bad signature gives `valid:false`; past `expiry` gives `expired:true`.

- [x] **A4 · P0 · Electrum client**
  Files: `packages/protocol/src/electrum.ts`
  Using `@electrum-cash/network` and `ELECTRUM_SERVERS[network]`: `getUtxos(address)`, `getHistory(address)`, `getTx(txid)` (raw hex), `broadcast(txHex)`; returns `Utxo` with token data when present.
  Done when: a small script lists UTXOs and history for a funded Chipnet address and fetches one tx.

- [x] **A5 · P0 · First exports for B and C**
  Files: `packages/protocol/src/index.ts`
  Export types, constants, request functions, electrum functions; add stubs for `buildPayment`, `findPayment`, `verifyReceipt` that throw "not implemented" with the final signatures.
  Done when: `import { createRequest, decodeLink } from '@nod/protocol'` works from `apps/web` and `packages/agent`; `npm test` is green.

### Nov 20

- [x] **A6 · P0 · Memo builder**
  Files: `packages/protocol/src/memo.ts`, `packages/protocol/test/memo.test.ts`
  `encodeMemo(kind, hash)`: `OP_RETURN` + push `MEMO_PREFIX_HEX` ("NOD") + push kind byte (`MEMO_KIND_SINGLE` or `MEMO_KIND_BATCH`) + push 32-byte hash. Batch hash = `hashBatch` (sha256 of the sorted request hashes concatenated). Plus `decodeMemo(lockingBytecode) -> { kind, hash } | null`.
  Done when: build then parse returns the same kind and hash; output stays under 223 bytes.

- [x] **A7 · P0 · Single payment tx**
  Files: `packages/protocol/src/tx.ts`, `packages/protocol/test/tx.test.ts`
  `buildPayment({ requests, utxos, changeAddress }) -> { txHex, sourceOutputs, inputPaths }` for one BCH request: coin selection from `SpendableUtxo[]`, vendor output, memo output, change (dropped if below `DUST_SATS`), fee at `FEE_SATS_PER_BYTE`. Match `sourceOutputs` to the shape in `@wizardconnect/dapp` types; `inputPaths` as `InputPath[]`.
  Done when: unit test decodes the tx and finds vendor output = requested sats, memo hash = request hash, inputs ≥ outputs + fee; rejects expired requests and insufficient funds.

- [x] **A8 · P0 · Receipt check and paid check**
  Files: `packages/protocol/src/receipt.ts`, `packages/protocol/test/receipt.test.ts`
  `verifyReceipt(txid, req) -> ReceiptCheck` (fetch tx, check vendor output amount, memo hash, reasons list); `findPayment(req) -> { txid } | null` (scan vendor history for a tx committing this hash).
  Done when: test with a fixture tx passes; wrong amount / wrong hash / wrong vendor each give `ok:false` with a clear reason; `findPayment` finds a real Chipnet payment.

- [x] **A9 · P1 · Batch payment**
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

- [x] **A12 · P1 · Protocol doc**
  Files: `docs/PROTOCOL.md`
  Request fields, canonical JSON, hash, signature, link format, memo layout (`NOD` + kind + hash), batch hash rule, paid check.
  Done when: someone outside the team could build a compatible agent from the doc alone.

- [x] **A13 · P3 · Allowance contract (stretch, only if P0–P2 are done)**
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

- [x] **B1 · P0 · Scaffold**
  Files: `apps/web/` (Vite + React + TS + Tailwind), `apps/web/src/main.tsx`, `apps/web/src/App.tsx` (routes `/`, `/r`, `/batch`, `/tx/:txid`)
  Done when: `npm run dev -w apps/web` serves the four routes with placeholder pages; `@nod/protocol` imports compile.

- [ ] **B2 · P0 · Banner (hackathon rule)**
  Files: `apps/web/src/components/Banner.tsx`
  Top-of-page bar on every route: link to slides (Widget Factory deck), link to public repo, the CashTokens address for **EMBER2026** votes (with copy button).
  Done when: banner shows on all routes at phone and desktop width; all three items work.
  Status (Nov 20): code done; open until `VITE_SLIDES_URL` and `VITE_EMBER2026_ADDRESS` are set on Vercel before the build (otherwise the banner shows a placeholder).

- [ ] **B3 · P0 · WizardConnect connect (biggest risk, do early)**
  Files: `apps/web/src/wallet/wizard.ts`, `apps/web/src/components/WalletButton.tsx`, `apps/web/src/main.tsx` (provider)
  Use `@wizardconnect/react`: `useWizardConnect`, `WizardConnectQRDialog`. Read the `@wizardconnect/dapp` types first (especially `sourceOutputs`). Get buyer addresses from `manager.getPubkey(0, 0n)` and derive the cashaddr (`bchtest:` on Chipnet).
  Done when: on **Chipnet**, Paytaca or Cashonize scans the QR, connects, and the app shows the wallet's address.
  Status (Nov 20): code done, incl. `wiz://` open-in-wallet deep link for phones (unverified that wallets handle it); open until a real wallet connects on Chipnet.

- [ ] **B4 · P0 · Sign and broadcast on Chipnet**
  Files: `apps/web/src/wallet/wizard.ts`
  `signAndBroadcast({ txHex, sourceOutputs, inputPaths, userPrompt })` calling
  `manager.signTransaction({ transaction: { transaction: txHex, sourceOutputs, userPrompt, broadcast: true }, inputPaths })`. Use a hand-built or mock tx until A7 lands.
  Done when: one Chipnet tx is approved on the phone and its txid appears in the app.
  Status (Nov 20): code done; `sourceOutputs` now converted with `sourceOutputToRelay` from `@wizardconnect/core` (fixed a bigint crash); change goes to the receive address. Open until a real Chipnet sign.

### Nov 20

- [ ] **B5 · P0 · Approval page**
  Files: `apps/web/src/pages/Request.tsx`, `apps/web/src/components/RequestCard.tsx`
  Read `#payload`, `decodeLink`, show agent name, vendor, amount, purpose, expiry countdown, "signature valid" badge; block if invalid, expired, or `findPayment` finds it already paid. **Nod** button → `getUtxos` → `buildPayment` → `signAndBroadcast` → go to `/tx/:txid`.
  Done when: a CLI-made Chipnet link is approved end-to-end from this page.
  Status (Nov 20): code done; paid check capped at 25 txs + 8 s timeout, network badge. Open until a real wallet approves a link.

- [x] **B6 · P0 · Receipt page**
  Files: `apps/web/src/pages/Receipt.tsx`, `apps/web/src/components/ReceiptCard.tsx`
  Shows txid, explorer link (`EXPLORER_TX_URL`), result of `verifyReceipt` ("request matches payment" or reasons), and the delivered item from `api/vendor/buy` when available.
  Done when: reloading `/tx/:txid` for a real tx shows OK; a tampered request shows the failure reasons.
  Status (Nov 20): done in code: vendor delivery panel with 402 retry, shareable receipts `/tx/<txid>#<payload>`.

- [x] **B7 · P0 · Home page and demo button**
  Files: `apps/web/src/pages/Home.tsx`, `apps/web/src/lib/api.ts`
  One-line pitch, **"Ask the agent to buy something"** → calls `api/demo-agent` → navigates to the returned link.
  Done when: a judge on a fresh browser reaches the approval page in one tap.
  Status (Nov 20): done: Home button calls `/api/demo-agent` (WP1) and opens the approval page.

- [ ] **B8 · P0 · Switch to mainnet**
  Files: `apps/web/src/wallet/wizard.ts`, env config (`VITE_NETWORK`)
  Done when: same flow works with a ~$0.01 mainnet request (with C, see Integration checkpoints).
  Status (Nov 20): `VITE_NETWORK=mainnet` switch in `config.ts`; open until a real mainnet payment.

### Nov 21

- [ ] **B9 · P1 · Batch page**
  Files: `apps/web/src/pages/Batch.tsx`
  Several request links → list with total → one approval → one tx with batch memo → receipt.
  Done when: a 3-request Chipnet batch is approved in one wallet prompt and each request verifies.
  Status (Nov 20): code done; batch receipts require one output per identical request (`batchRequests`). No already-paid check on the batch page (low). Open until a real 3-request batch.

- [ ] **B10 · P1 · Fallback QR**
  Files: `apps/web/src/components/FallbackQR.tsx`, `apps/web/src/pages/Request.tsx`
  For wallets without WizardConnect: plain `bitcoincash:<vendor>?amount=<bch>` QR; poll vendor address and match by address + amount; label it "no memo, matched by amount".
  Done when: paying the QR from a normal wallet moves the page to a receipt.
  Status (Nov 20): not started; cut (WizardConnect is required by the rules).

- [x] **B11 · P1 · Mobile polish, loading and error states**
  Files: `apps/web/src/pages/*`, `apps/web/src/components/*`
  Spinners for connect/sign/broadcast, clear errors (wallet rejected, not enough funds, expired, already paid), 375px layout, no horizontal scroll.
  Done when: full demo works on a phone browser with no layout breaks; each error case shows a readable message.
  Status (Nov 20): done in code: insufficient-funds message, 375px layout, banner links visible on phones. Re-check on a real phone in the launch checklist.

- [ ] **B12 · P3 · Allowance page (stretch)**
  Files: `apps/web/src/pages/Allowance.tsx`
  Done when: owner can fund and cancel an allowance on Chipnet (needs A13).
  Status (Nov 20): not started; cut.

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
  Status (Nov 20): build config done (`apps/web/vercel.json`, `build:vercel`, `docs/DEPLOY.md`); open until the real Vercel project deploys.

- [x] **C4 · P0 · Demo agent stub**
  Files: `api/demo-agent.ts`
  Returns a signed request link for a $0.01 item from the demo vendor, using `createRequest` (or a mock until A3 lands). Agent key from env `NOD_DEMO_AGENT_KEY`.
  Done when: `curl <app>/api/demo-agent` returns a link that opens the approval page.
  Status (Nov 20): done: `apps/web/server/demoAgent.ts`, served as `GET /api/demo-agent` (ephemeral-key fallback with warning).

### Nov 20

- [x] **C5 · P1 · Agent keys and CLI**
  Files: `packages/agent/src/keys.ts`, `packages/agent/src/cli.ts`
  `keys.ts`: create/load agent key (file or env). `cli.ts`: `nod request --vendor --sats --purpose`, `nod status <id>`, `nod list`.
  Done when: CLI prints a working Chipnet link and later reports paid with txid.
  Status (Nov 20): done: `packages/agent` CLI `key` / `request` / `status` / `list`. Open part: a real paid Chipnet status.

- [x] **C6 · P1 · MCP server**
  Files: `packages/agent/src/mcp.ts`
  `@modelcontextprotocol/sdk` stdio server with tools `nod_request_payment` (returns link), `nod_payment_status` (uses `findPayment` + `verifyReceipt`), `nod_list_requests` (local log of created requests).
  Done when: added to Claude, "buy one weather call" returns a link, and after approval `nod_payment_status` reports paid.
  Status (Nov 20): done in code: hand-written MCP stdio server with tools `nod_request_payment`, `nod_payment_status`, `nod_list_requests`. Open part: adding it to Claude (launch checklist).

- [x] **C7 · P1 · Demo vendor**
  Files: `api/vendor/buy.ts`
  Takes `{ txid, req }` (or the link payload), runs `verifyReceipt`, returns the item (e.g. a weather report or joke) only if `ok`.
  Done when: valid txid returns the item; wrong txid or unpaid request returns an error.
  Status (Nov 20): done: `apps/web/server/vendor.ts`, `POST /api/vendor/buy`; delivers only for >= `NOD_DEMO_SATS` and the configured agent key.

- [ ] **C8 · P0 · First mainnet payment end-to-end (by tonight)**
  With A and B: fund a test wallet with a little BCH, run the demo flow on mainnet.
  Done when: mainnet txid on an explorer, receipt page OK, vendor releases the item.

### Nov 21

- [ ] **C9 · P1 · Slides (Widget Factory template)**
  Copy the template: https://docs.google.com/presentation/d/1Yfuk9CJkf4U9M_WukcELhumWgj3Ak6345Ewy8hSp-Hk/edit
  Problem, agent angle, 30-second demo, how it uses BCH (OP_RETURN receipts, WizardConnect, CashTokens), business model, team; credit Requisition as inspiration.
  Done when: deck is shared "anyone with link can view" and the banner links to it.

- [x] **C10 · P1 · README**
  Files: `README.md`
  Pitch, live link, demo steps, architecture sketch, `npm install` / `npm test`, MCP setup, credit to Requisition.
  Done when: a new reader can run the demo and add the MCP server from the README alone.
  Status (Nov 20): done: `README.md`.

- [ ] **C11 · P1 · Video draft (60–90 s)**
  Files: `docs/DEMO.md` (script)
  Screen + phone capture of: agent asks → approval page → Nod in wallet → receipt → item delivered. Include a Claude/MCP clip.
  Done when: draft under 90 s uploaded (unlisted) and shared with the team.
  Status (Nov 20): script ready in `docs/DEMO.md`; recording is human-only.

- [ ] **C12 · P1 · Social posts**
  X thread and Telegram post with the live link, short clip, EMBER2026 address.
  Done when: both posted; links saved for the submission.
  Status (Nov 20): drafts ready in `docs/SUBMISSION.md`; posting is human-only.

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
  Status (Nov 20): text ready in `docs/SUBMISSION.md`; submitting is human-only.

---

## Integration checkpoints

### 1. Shared API (built and exported from `@nod/protocol`)
These are the real signatures. Do not change them without telling the team:
```ts
// requests (agent side)
generateAgentKey() -> { privateKey, publicKey }
createRequest(fields, agentPrivateKey) -> SignedNodRequest            // { req, sig }
buildRequestUrl(baseUrl, signed) -> string                            // `${baseUrl}/r#${payload}`
decodeLink(payload) -> { signed, valid, expired }                     // throws on malformed payload
hashRequest(req) -> Uint8Array                                        // 32 bytes
hashBatch(hashes) -> Uint8Array

// chain
const chain = new NodElectrum('chipnet' | 'mainnet'); await chain.connect()
chain.getUtxos(address) / getHistory(address) / getTransactionHex(txid) / broadcast(txHex)

// paying (web app)
buildPayment({ network, payments: [{ vendor, amount, requestHash }], utxos: SpendableUtxo[], changeAddress })
  -> { txHex, transaction, sourceOutputs, inputPaths, fee, memo }
// then: manager.signTransaction({ transaction: { transaction: txHex, sourceOutputs, userPrompt, broadcast: true }, inputPaths })

// receipts (web app, vendor, MCP)
findPayment(chain, req, requestHash, { batchHashes?, maxTxs? }) -> { txid } | null
verifyReceipt(chain, txid, req, requestHash, { batchHashes? }) -> { ok, reasons[] }
```
- [x] Exported from `@nod/protocol` (A5); 54 protocol tests + 9 contract tests green.
- [ ] B checks `sourceOutputs` against the real `@wizardconnect/dapp` types (current shape follows the WalletConnect-BCH convention: libauth `Input & Output` per input).

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

---

## Remaining build plan (Nov 20)

Audit of the code on Nov 20: `apps/web` typechecks and builds; pages, wallet, banner and batch are coded but nothing has been run against a real wallet yet. `/api/demo-agent` and `/api/vendor/buy` do not exist, `packages/agent` does not exist, and there is no deploy config. Fallback QR (B10) and the allowance page (B12) are cut.

The work is split into three packages with **strictly disjoint files**. A builder may only create or edit the files listed for its package. No package adds npm dependencies (builders do not run `npm install`); anything that would need a new dependency is done without it.

**Status (Nov 20, end of day): WP1, WP2 and WP3 are built and tested** (protocol 55 + 1 skipped, agent 12, web/server 15, contracts 9; all typechecks and `build:vercel` pass). Verifier fixes landed: `sourceOutputToRelay` for WizardConnect, change to receive address, vendor amount/agent checks, network prefix check, `batchRequests` receipt rule. Nothing has been signed by a real wallet or deployed yet: see the launch checklist below.

### Decisions

- **Deploy:** one Vercel project with **Root Directory = `apps/web`**. Handler sources live in `apps/web/server/` (not `api/`), and a build script writes the [Vercel Build Output API](https://vercel.com/docs/build-output-api/v3) folder `apps/web/.vercel/output/` (static files from `dist/` + one bundled function per endpoint). Why: `@nod/protocol` ships raw TypeScript with `.js` import specifiers, which Vercel's zero-config `api/*.ts` functions do not reliably compile when imported from a workspace package; bundling ourselves makes each function self-contained and testable locally. Keeping sources out of `api/` stops Vercel from also attempting zero-config builds. Paths stay `/api/demo-agent` and `/api/vendor/buy`, so `apps/web/src/lib/api.ts` needs no URL change.
- **Bundler:** Vite's own build API (SSR/library mode) or `rolldown` (a hard dependency of Vite 8, already installed). Do not rely on `esbuild` (only an optional peer) or `tsx` (not installed).
- **MCP server:** hand-written JSON-RPC 2.0 over stdio (`initialize`, `tools/list`, `tools/call`, `ping`), because `@modelcontextprotocol/sdk` is not installed.

### HTTP contract (WP1 implements, WP2 consumes; do not change without telling both)

`GET /api/demo-agent` → `200 { link: string, hash: string, network: 'mainnet'|'chipnet', expiresAt: number, warning?: string }`
- Signs a fresh request with `createRequest`: `agentName` "Nod demo agent", `vendor` = `NOD_DEMO_VENDOR`, `amount: { sats: NOD_DEMO_SATS }` (default 2000), `purpose` "1 live weather report" (≤140 chars), `expiry` = now + 15 min.
- Key from `NOD_DEMO_AGENT_KEY` (64 hex). If unset: generate an ephemeral key once per cold start, `console.warn` about it, and return `warning: "ephemeral agent key"`.
- Vendor: if `NOD_DEMO_VENDOR` is unset on chipnet, derive a P2PKH address from the agent key; on mainnet return `500 { error: "NOD_DEMO_VENDOR is not set" }` (never send real funds to a key nobody keeps).
- Link base URL: `NOD_PUBLIC_URL` if set, else `https://${x-forwarded-host || host}` (`http://` for localhost).
- Network: `NOD_NETWORK`, else `VITE_NETWORK`, else `chipnet`. Must equal the web app's `VITE_NETWORK`.
- `Cache-Control: no-store`.

`POST /api/vendor/buy` with body `{ txid: string, signed: SignedNodRequest }` →
- `200 { ok: true, item: { title: string, body: string, deliveredAt: number } }` when `verifyRequest(signed)` is true, `signed.req.vendor` equals the demo vendor, and `verifyReceipt(chain, txid, req, hashRequest(req))` is ok. Item: a real weather report from `api.open-meteo.com` (no key, 2 s timeout) with a canned fallback.
- `402 { ok: false, reasons: string[] }` when the receipt check fails (unpaid, wrong amount, wrong memo, tx not found yet).
- `400 { error }` on a malformed body; `500 { error }` if no Electrum server answers.
- Stateless: repeat calls for the same paid request return the item again (documented demo simplification).

### WP1 · API endpoints and Vercel deploy (P0)

Owns (create/edit only these):
- `apps/web/server/**` (new: e.g. `env.ts`, `demoAgent.ts`, `vendor.ts`, `node-adapter.ts`, plus `*.test.ts`)
- `apps/web/scripts/build-vercel.mjs` (new)
- `apps/web/vite.config.ts` (dev-only middleware serving `/api/*` from `apps/web/server/` via `ssrLoadModule`)
- `apps/web/package.json` (scripts only: `build:vercel`, `test`; no new dependencies)
- `apps/web/tsconfig.json` (only if `server/` needs typechecking), `apps/web/vercel.json` (new), `apps/web/.env.example` (new)
- `docs/DEPLOY.md` (new: Vercel settings, env vars, verification steps)

Tasks:
1. Handlers as web-standard `(request: Request) => Promise<Response>` in `apps/web/server/`, implementing the contract above.
2. Dev middleware so `npm run dev -w @nod/web` serves the app and `/api/*` together.
3. `build-vercel.mjs` (runs after `vite build`): write `.vercel/output/config.json` (`version: 3`; routes `{ handle: 'filesystem' }` then SPA fallback `/(.*)` → `/index.html`), copy `dist/` to `.vercel/output/static/`, and for each endpoint write `.vercel/output/functions/api/<name>.func/` with a fully bundled `index.mjs` (all dependencies inlined, Node 22 target) and `.vc-config.json` (`runtime: nodejs22.x`, `handler: index.mjs`, `launcherType: Nodejs`), adapting the web handler to Node `(req, res)`.
4. `vercel.json`: `buildCommand: npm run build:vercel`, `framework: null`, install from the repo root (`installCommand: cd ../.. && npm install`).
5. `.env.example` + `docs/DEPLOY.md` listing `VITE_NETWORK`, `VITE_SLIDES_URL`, `VITE_EMBER2026_ADDRESS`, `NOD_NETWORK`, `NOD_DEMO_AGENT_KEY`, `NOD_DEMO_VENDOR`, `NOD_DEMO_SATS`, `NOD_PUBLIC_URL`, and a one-liner to generate an agent key.

Done when:
- `npx vitest run apps/web/server` passes: demo-agent returns a link whose payload `decodeLink` reports `valid: true, expired: false`; mainnet without vendor gives 500; vendor/buy with a garbage body gives 400 and with an unpaid request (mock `ChainReader`) gives 402.
- `npm run build:vercel -w @nod/web` produces `.vercel/output/` with `static/index.html` and two `.func` folders.
- Copying `functions/api/demo-agent.func/` to an empty temp folder outside the repo and calling its handler with Node returns a valid link (proves nothing was left external).
- `npm run dev -w @nod/web`, then `curl localhost:5173/api/demo-agent` returns `{ link }`, and the Home button opens the approval page.
- `npx tsc --noEmit -p apps/web` still passes.

### WP2 · Web app finish (P0/P1)

Owns: `apps/web/src/**` and `apps/web/index.html` only. No `package.json`, config files or new dependencies.

Tasks:
1. **Delivered item (B6):** add `buyFromVendor(txid, signed)` to `lib/api.ts` per the contract. Receipt page: after a single verified request, call it (retry up to 3× with 2 s gaps on 402 while the tx propagates) and show the item in `ReceiptCard` ("Delivered by the vendor"). Hide the section quietly on 404 (endpoint absent) or when the vendor is not the demo vendor.
2. **Shareable receipt:** after a single payment navigate to `/tx/<txid>#<payload>` so a fresh browser can still verify; Receipt uses the hash payload when sessionStorage has nothing.
3. **Fast paid check (B5):** pass `{ maxTxs: 25 }` to `findPayment` on the approval page (the scan is sequential and keeps the Nod button disabled; the demo vendor will collect many txs).
4. **Errors (B11):** map insufficient-funds errors from `buildPayment` to "This wallet does not have enough BCH for this payment plus fee."; show demo-agent `warning` as a small note on Home when present.
5. **Phones (B11):** check Home, Request, Receipt at 375px (Browser pane mobile preset) for horizontal scroll; make sure the WizardConnect URI can be copied on the same phone (the dialog has a copy button; verify it is visible on narrow screens).
6. Network clarity: the approval page shows a prominent MAINNET / CHIPNET badge next to the amount.

Done when: `npx tsc --noEmit` and `npx vite build` in `apps/web` pass; with WP1's dev server running, Home → demo button → approval page shows the request with "signature valid"; opening `/tx/<real chipnet txid>#<payload>` in a fresh tab shows a verification result (not "open from the approval page"); no horizontal scroll at 375px on the three pages.

### WP3 · Agent tool (CLI + MCP) and submission docs (P1)

Owns: `packages/agent/**` (new), `README.md`, `docs/DEMO.md` (new), `docs/SUBMISSION.md` (new).

Tasks:
1. `packages/agent/package.json` (`@nod/agent`, `bin: { nod: dist/cli.mjs, nod-mcp: dist/mcp.mjs }`, depends only on `@nod/protocol` and already-installed packages) and `build.mjs` bundling `src/cli.ts` and `src/mcp.ts` into `dist/` (Vite build API or rolldown; deps may stay external because it runs inside the repo).
2. `src/keys.ts`: key from `NOD_AGENT_KEY`, else `~/.nod/agent.key`, else create it and print the pubkey.
3. `src/store.ts`: JSON log of created requests in `~/.nod/requests.json` (id, hash, link, createdAt, network); path overridable by `NOD_HOME` for tests.
4. `src/cli.ts`: `nod request --vendor <addr> --sats <n> --purpose <text> [--name] [--expires 30m] [--base-url]`, `nod status <id|hash>` (`findPayment` + `verifyReceipt`, prints txid + explorer URL), `nod list`, `nod key`. Base URL from `NOD_BASE_URL` or `http://localhost:5173`; network from `NOD_NETWORK` (default chipnet).
5. `src/mcp.ts`: stdio JSON-RPC MCP server with tools `nod_request_payment`, `nod_payment_status`, `nod_list_requests` (hand-written JSON Schemas); logs only to stderr.
6. Tests (`packages/agent/test/*.test.ts`, vitest): key load/create in a temp `NOD_HOME`, CLI argument parsing, MCP `initialize` → `tools/list` → `tools/call nod_request_payment` returning a link that `decodeLink` validates (in-process, no network).
7. `README.md`: pitch, live-link placeholder, 30-second demo, architecture sketch, `npm install` / `npm test`, MCP setup snippet for Claude Desktop / Claude Code (`node packages/agent/dist/mcp.mjs`), links to `docs/PROTOCOL.md` and `docs/DEPLOY.md`, credit to Requisition.
8. `docs/DEMO.md`: 75-second video script with shot list and on-screen captions. `docs/SUBMISSION.md`: DoraHacks description (agent angle first), slide-by-slide text for the Widget Factory template copy, X thread (4 posts), Telegram post, final pre-submit checklist with link placeholders.

Done when: `npx vitest run packages/agent` passes; `node packages/agent/build.mjs`, then `node packages/agent/dist/cli.mjs request --vendor bchtest:qr4upmst92u7sfm6vqxz29r4ug4rysdpcytc853pps --sats 1000 --purpose test` prints a link the approval page accepts; piping an `initialize` + `tools/list` request into `node packages/agent/dist/mcp.mjs` returns the three tools; every relative link in README resolves.

### Launch checklist (human-only, in order)

Builders cannot do these. Do them top to bottom; each step depends on the one before.

1. [ ] **Real-wallet Chipnet test (biggest remaining risk).** `npm run dev -w @nod/web` with `VITE_NETWORK=chipnet`; fund a Paytaca or Cashonize chipnet wallet from tbch.googol.cash; connect via WizardConnect QR, demo button → Nod → approve on the phone → receipt shows "request matches payment" and the delivered item. Covers A10, B3, B4, B5 and Integration checkpoint 2. Also try the `wiz://` open-in-wallet link on a phone.
2. [ ] Run `npm install` at the repo root (registers `packages/agent` in `package-lock.json`), then `npm test`; commit the lockfile.
3. [ ] Make the GitHub repo public (banner and footer point to `github.com/aagneye/nod`).
4. [ ] Get the team's **EMBER2026 CashTokens address**.
5. [ ] Copy the Widget Factory slide template, paste the text from `docs/SUBMISSION.md`, share "anyone with link can view".
6. [ ] Create the Vercel project (Root Directory `apps/web`) and set env vars **before the first build** (`VITE_*` are baked in at build time): `VITE_NETWORK=mainnet`, `NOD_NETWORK=mainnet`, `NOD_DEMO_AGENT_KEY` (generate per `docs/DEPLOY.md`), `NOD_DEMO_VENDOR` (mainnet address the team controls), `NOD_DEMO_SATS` (~$0.01 at today's price), `VITE_EMBER2026_ADDRESS`, `VITE_SLIDES_URL`. Deploy and run the checks in `docs/DEPLOY.md` (C3).
7. [ ] **Mainnet end-to-end** on the live URL from a fresh phone + browser: demo button → Nod → receipt OK → item delivered; open the txid on explorer.bch.ninja; keep the txid (B8, C8, checkpoint 3).
8. [ ] Open a chipnet txid on `chipnet.chaingraph.cash` in a browser (it returned 403 to curl); swap `EXPLORER_TX_URL.chipnet` if it fails.
9. [ ] Add the MCP server to Claude using the README snippet; ask it to buy one weather report, approve, confirm `nod_payment_status` reports paid; record the clip.
10. [ ] Record the 60–90 s video from `docs/DEMO.md`, upload, link it in README and slides (C11, C14).
11. [ ] Post in BLAZE Telegram ("project is real") and on X from `docs/SUBMISSION.md`; save the links (C1, C12).
12. [ ] DoraHacks submission by **15:00 IST Nov 22** from `docs/SUBMISSION.md`; open every link in a private window (C15, checkpoint 4).
13. [ ] Optional: confirm PUSD category/decimals (A11). Optional (low): add an already-paid check to the batch page.
