# Deploying Nod

Nod has three parts to deploy:

| Part | Where | Why |
| --- | --- | --- |
| Standalone server (`apps/web/server/standalone.ts`) | A machine with a fixed public IP that HSP has allowlisted (a small VPS, or the team's machine for the demo) | HSP Agentic Payment (https://mcp-qa.hashkeymerchant.com/) only accepts calls from allowlisted IPs. The server serves the web app and every `/api` route on one port. |
| Static web app (optional) | Vercel | Forwards `/api` to the standalone server (`NOD_API_PROXY`), or calls it directly (`VITE_API_BASE`). |
| Contracts `NodReceipts` and `NodPolicy` | HSK Chain testnet (chain 133) for trials, HSK Chain mainnet (chain 177) for the submission | The server anchors receipts in `NodReceipts`. |

The API routes, all served by `apps/web/server/api.ts` (response shapes in `apps/web/server/types.ts`):

| Route | Calls HSP | What it does |
| --- | --- | --- |
| `GET /api/config` | `get_chain_config` (probe, cached 5 min) | HSP mode and reachability, the payment option, contract addresses, demo price |
| `GET /api/demo-agent` | no | The demo seller agent signs fresh terms for one weather report and returns the link |
| `POST /api/pay/start` | `create_order`, `prepare_payment` | Verifies the terms, refuses already-paid terms, returns HSP's EIP-712 authorization |
| `POST /api/pay/finish` | `finalize_payment`, `submit_payment` | Hands the wallet signature to HSP |
| `GET /api/pay/status` | `query_payment` | HSP status, settlement transaction, explorer link |
| `POST /api/pay/settle` | `query_payment` | Checks the token transfer on chain and anchors the receipt in `NodReceipts` |
| `GET /api/receipt` | no | Reads the receipt anchored for a `termsHash` |
| `POST /api/vendor/buy` | `query_payment` | The demo seller agent checks the payment and delivers a weather report |

Errors are JSON `{ "error": "...", "code": "..." }`.

## 1. HSP allowlist

Do this first; the HSP team confirms by hand.

1. Choose the machine that will run the standalone server. Its public IP must not change, so prefer a VPS with a static IP over a home connection.
2. Find its public egress IP on that machine:
   ```bash
   curl -4 ifconfig.me
   curl -6 ifconfig.me      # only if the machine has IPv6; send both addresses
   ```
3. Send the IP (and your team name) to the HSP team in the support group: https://t.me/+o8jNDBE_cf44NWFl
4. Wait for their confirmation. Until then every HSP call fails and the pay routes answer `503 hsp_unavailable`. Use `HSP_MODE=mock` for development in the meantime.
5. Check it once confirmed: start the server on that machine (section 4). The log shows
   ```
   [nod] connecting to HSP at https://mcp-qa.hashkeymerchant.com/ ...
   [nod/hsp] connected to https://mcp-qa.hashkeymerchant.com/ (<server name> <version>), session <id>
   [nod/hsp] <n> live tools:
   ```
   followed by each live tool and its input schema. `GET /api/config` then shows `"reachable": true` and an `option`. If HSP still refuses, the log says `HSP warm-up failed: HSP at … refused the connection (HTTP 403) …` or `HSP warm-up failed: Could not reach HSP at …`.

## 2. Contracts on HSK Chain

You need a deployer wallet with native HSK for gas: testnet HSK from the faucet (https://faucet.hsk.xyz/faucet) and a little mainnet HSK for the mainnet deploy. Use a fresh key for this.

1. Put the key in `contracts/.env` (git-ignored):
   ```bash
   cp contracts/.env.example contracts/.env        # PowerShell: Copy-Item contracts/.env.example contracts/.env
   # then edit contracts/.env:  DEPLOYER_PRIVATE_KEY=0x<64 hex>
   ```
   `hardhat.config.ts` reads `contracts/.env`; values already set in the shell win. Without the key the deploy stops before sending anything.
2. Deploy to HSK Chain testnet:
   ```bash
   npm run deploy:hsk-testnet -w @nod/contracts
   ```
   The script deploys `NodReceipts`, then `NodPolicy`, waits for both receipts, prints the addresses with explorer links, and writes `contracts/deployments/hskTestnet.json` with this shape:
   ```
   {
     "network": "hskTestnet",
     "chainId": 133,
     "deployer": "0x…",
     "NodReceipts": { "address": "0x…", "txHash": "0x…", "block": <number> },
     "NodPolicy": { "address": "0x…", "txHash": "0x…", "block": <number> },
     "deployedAt": "<ISO time>"
   }
   ```
3. Deploy to HSK Chain mainnet. The script refuses chain 177 unless `CONFIRM_MAINNET=yes` is set in the shell; the value is ignored in `contracts/.env` on purpose.
   ```bash
   CONFIRM_MAINNET=yes npm run deploy:hsk-mainnet -w @nod/contracts
   ```
   ```powershell
   $env:CONFIRM_MAINNET='yes'; npm run deploy:hsk-mainnet -w @nod/contracts; Remove-Item Env:CONFIRM_MAINNET
   ```
   This writes `contracts/deployments/hskMainnet.json`. The deployment records are meant to be committed (`contracts/.gitignore` only ignores local dry runs).
4. Verify the source on Blockscout. The deploy script prints these lines; run them from `contracts/`. Neither contract has constructor arguments.
   ```bash
   cd contracts
   npx hardhat verify --network hskMainnet <NodReceipts address>
   npx hardhat verify --network hskMainnet <NodPolicy address>
   ```
   Use `--network hskTestnet` for the testnet deployment. Explorers: https://hsk.blockscout.com (mainnet), https://testnet-explorer.hskchain.net (testnet).
5. Copy the addresses into the server environment (`NOD_RECEIPTS_ADDRESS`, `NOD_POLICY_ADDRESS`, section 3) and into the README and `docs/SUBMISSION.md` placeholders.

`npm run deploy:sepolia -w @nod/contracts` exists for trying the contracts on Sepolia (optional `SEPOLIA_RPC_URL` in `contracts/.env`). It is not needed for the submission.

## 3. Server environment

Every variable the server reads is validated in `apps/web/server/config.ts`; `apps/web/.env.example` has the same list with comments. Set them in `apps/web/.env.local` (the Vite dev server and the standalone server both read it; real environment variables win) or in the environment of the process (systemd, `docker run --env-file`). An invalid value makes every `/api` request answer `500 config_error`, and the standalone server exits at start with `[nod] Invalid server configuration: ...` naming the variable.

### HSP

| Variable | Default | Meaning |
| --- | --- | --- |
| `HSP_MODE` | `live` | `live` calls HSP over MCP. `mock` simulates HSP in memory for development only: Sepolia test USDC, a fake settlement transaction, and the on-chain check and receipt anchor are skipped. |
| `HSP_MCP_URL` | `https://mcp-qa.hashkeymerchant.com/` | HSP Agentic Payment MCP endpoint (Streamable HTTP) |
| `NOD_MERCHANT_NAME` | none | The team's HSP reporting name, sent with every order and status query. Required in live mode: without it the pay routes answer `503 not_configured`. At most 128 characters. Mock mode uses `Nod (mock HSP)`. |
| `NOD_PAY_NETWORK` | none | Pick this `get_chain_config` network (as HSP spells it, or a chain id) |
| `NOD_PAY_CHAIN_ID` | none | Pick this chain id |
| `NOD_PAY_COIN` | none | Pick this coin symbol |

Without `NOD_PAY_*`, Nod takes HSK Chain testnet USDC if HSP offers it, otherwise the first USDC option, otherwise the first option, and prefers the `eip3009` entry for that token. If the filters match nothing, the pay routes answer `502 no_payment_option`.

### Contracts on HSK Chain

| Variable | Default | Meaning |
| --- | --- | --- |
| `NOD_RECEIPTS_CHAIN` | `hsk-testnet` | Chain of the contracts: `hsk-testnet` (133) or `hsk-mainnet` (177). The chain ids also work, and `sepolia` is accepted for trials. |
| `NOD_RECEIPTS_ADDRESS` | none | `NodReceipts` address, from `contracts/deployments/<network>.json` |
| `NOD_POLICY_ADDRESS` | none | `NodPolicy` address (shown in `/api/config` and the app's status panel) |
| `NOD_RECORDER_KEY` | none | Private key (`0x` + 64 hex) that sends `NodReceipts.anchor`. Secret. Needs a little HSK for gas on the receipts chain. Without it the settlement is still checked, but anchoring is skipped and the response says so. |
| `NOD_RECORDER_ADDRESS` | none | Read-only alternative: the recorder address to look receipts up under, without the key. Must match the key when both are set. |

The recorder's address appears in the server's start-up log (`[nod] receipts: chain …, contract …, recorder 0x…`) and in `/api/config`. Send that address a little HSK.

### RPC endpoints

| Variable | Default |
| --- | --- |
| `HSK_MAINNET_RPC` | `https://mainnet.hsk.xyz` |
| `HSK_TESTNET_RPC` | `https://testnet.hsk.xyz` |
| `SEPOLIA_RPC` | `https://ethereum-sepolia-rpc.publicnode.com` |

The settlement check reads the payment network's RPC (Sepolia for HSP's test USDC); anchoring uses the receipts chain's RPC.

### Demo seller agent

| Variable | Default | Meaning |
| --- | --- | --- |
| `NOD_DEMO_AGENT_KEY` | none | The demo agent's signing key (`0x` + 64 hex). Secret. Unset: a new key per process, and `/api/demo-agent` adds `"warning": "ephemeral agent key"`. |
| `NOD_DEMO_VENDOR` | the agent's own address | Address the demo agent asks to be paid. Set it to an address the team controls. |
| `NOD_DEMO_USD` | `0.10` | Price of one weather report in USD: above 0, at most 10000, at most 2 decimals |

Generate a key: `node -e "console.log('0x'+require('crypto').randomBytes(32).toString('hex'))"`

### Server

| Variable | Default | Meaning |
| --- | --- | --- |
| `NOD_PUBLIC_URL` | the request's own origin | Public origin used in links. Also read at build time to make the social preview image URL absolute. |
| `NOD_CORS_ORIGIN` | `*` | `Access-Control-Allow-Origin` for `/api`: `*`, a comma-separated list of origins, or `off` |
| `PORT` | `8787` | Standalone server only |
| `HOST` | `0.0.0.0` | Standalone server only |
| `NOD_STATIC_DIR` | `dist/` beside the bundle | Standalone server only: the built web app to serve |

### Build time

| Variable | Meaning |
| --- | --- |
| `VITE_API_BASE` | Origin the browser calls for `/api` when it is not the app's own origin. Baked into the bundle. |
| `NOD_API_PROXY` | Vercel build only: Vercel forwards `/api/*` to this origin and no functions are built |

### A mainnet setup

`apps/web/.env.local` on the standalone server (keep comments on their own lines; `docker run --env-file` does not strip comments after a value):

```bash
HSP_MODE=live
NOD_MERCHANT_NAME=<your HSP reporting name>
NOD_RECEIPTS_CHAIN=hsk-mainnet
NOD_RECEIPTS_ADDRESS=<NODRECEIPTS_MAINNET>
NOD_POLICY_ADDRESS=<NODPOLICY_MAINNET>
# secret; the address needs a little mainnet HSK for gas
NOD_RECORDER_KEY=0x...
# secret
NOD_DEMO_AGENT_KEY=0x...
# an address the team controls
NOD_DEMO_VENDOR=0x...
NOD_PUBLIC_URL=<LIVE_URL>
```

## 4. Run the standalone server

On the allowlisted machine:

```bash
git clone https://github.com/aagneye/nod.git
cd nod
npm install
# write apps/web/.env.local (section 3)
npm run serve -w @nod/web
```

`npm run serve` builds `apps/web/dist` if it is missing, bundles the server into `apps/web/.server/standalone.mjs`, and starts it. Add `-- --rebuild` to rebuild the web app, for example after changing a `VITE_*` value. `npm run build:standalone -w @nod/web` builds both without starting; `node apps/web/.server/standalone.mjs` then runs the bundle with only `dist/` beside it.

The start-up log says what the server is wired to:

```
[nod] standalone server on http://localhost:8787 (listening on 0.0.0.0)
[nod] HSP: live at https://mcp-qa.hashkeymerchant.com/ (this machine's public IP must be allowlisted by HSP)
[nod] merchant name: <NOD_MERCHANT_NAME>
[nod] receipts: chain 177, contract 0x…, recorder 0x…
[nod] web app: …/apps/web/dist
```

Every `/api` request is logged with its status and duration, and every HSP call with its duration.

Keep it running with systemd or Docker, and put HTTPS in front of it (any reverse proxy). The server honours `x-forwarded-proto` and `x-forwarded-host`.

### Docker

Build from the repo root; the build needs the workspace lockfile and `packages/protocol`:

```bash
docker build -f apps/web/Dockerfile -t nod .
docker run --rm -p 8787:8787 --env-file apps/web/.env.local nod
```

`VITE_API_BASE` and `NOD_PUBLIC_URL` are baked in at build time: pass them with `--build-arg`. Everything else is read at run time. The container's outgoing traffic normally uses the host's IP, which is the one HSP must allowlist.

## 5. Static app on Vercel

> **Warning.** HSP calls from Vercel functions are refused: Vercel functions have no fixed IP, so they cannot be on the HSP allowlist. Without `NOD_API_PROXY` the build creates one function per `/api` route, and on Vercel the HSP routes (`/api/pay/*`, `/api/vendor/buy`, and the HSP probe in `/api/config`) answer `503 hsp_unavailable`. The build prints a note saying so.

Deploy prebuilt: `npm run build:vercel` writes the Build Output API v3 folder `apps/web/.vercel/output` locally, and `vercel deploy --prebuilt` uploads it as is. Vercel then never runs `npm install` on its own build machines.

Once per machine and project:

```bash
cd apps/web
npx vercel@latest login
npx vercel@latest link        # writes .vercel/project.json (git-ignored)
```

### Option A: Vercel forwards `/api` to the standalone server (recommended)

```bash
cd apps/web
NOD_API_PROXY=https://api.example.com NOD_PUBLIC_URL=<LIVE_URL> npm run build:vercel
npx vercel@latest deploy --prebuilt --prod
```

```powershell
cd apps/web
$env:NOD_API_PROXY='https://api.example.com'; $env:NOD_PUBLIC_URL='<LIVE_URL>'; npm run build:vercel
npx vercel@latest deploy --prebuilt --prod
```

`https://api.example.com` stands for the standalone server's public origin. The build prints `/api/* proxies to https://api.example.com/api/* (NOD_API_PROXY); no functions built`. The browser stays on one origin, so no CORS setup is needed. Set `NOD_PUBLIC_URL=<LIVE_URL>` on the standalone server too, so the links it signs open the public app.

### Option B: the browser calls the standalone server directly

```bash
cd apps/web
VITE_API_BASE=https://api.example.com NOD_PUBLIC_URL=<LIVE_URL> npm run build:vercel
npx vercel@latest deploy --prebuilt --prod
```

- The server must be on HTTPS: browsers block calls from an HTTPS page to an HTTP API.
- CORS is open by default; narrow it with `NOD_CORS_ORIGIN=<LIVE_URL>` on the server.
- The Vercel functions are still built, and their HSP routes answer 503. Agents use `NOD_BASE_URL` for both links and status checks, so point them at the standalone server's origin (it serves the app too).

`apps/web/vercel.json` holds the install and build commands for dashboard (git) deploys (Root Directory `apps/web`). The prebuilt path above does not need them.

## 6. Checks after a deploy

Run these against the public app (`<LIVE_URL>`) and against the server directly. They are bash commands; in Windows PowerShell type `curl.exe` instead of `curl`.

```bash
BASE=<LIVE_URL>

curl -s $BASE/api/config
```

Expect `"mode":"live"`, `"reachable":true`, your `merchantName`, an `option` (network, chain id, token, decimals, `eip3009` or `permit2`), `receipts` with `"chainId":177`, the `NodReceipts` address and a `recorder`, `policy` with the `NodPolicy` address, and no `error` field.

```bash
curl -s $BASE/api/demo-agent
# {"link":"<LIVE_URL>/r#…","signed":{…},"termsHash":"0x…"}   no "warning" when NOD_DEMO_AGENT_KEY is set

curl -s "$BASE/api/receipt?termsHash=0x0000000000000000000000000000000000000000000000000000000000000000"
# {"anchored":false,…}   a "reason" field means NOD_RECEIPTS_ADDRESS or the recorder is not set

curl -s -X POST -H 'content-type: application/json' -d '{}' $BASE/api/pay/start
# 400 {"error":"Send the terms as payload (the link or its #payload part) or as signed ({ terms, sig })","code":"bad_request"}

curl -s -o /dev/null -w '%{http_code}\n' $BASE/r
# 200 (app route)
```

Then pay once end to end (`docs/DEMO.md`): **Try the demo** → **Nod — approve payment** → **Sign in wallet**. The receipt page must reach **Paid**, then show **Transfer verified** and **Anchored** with an anchor transaction on https://hsk.blockscout.com, then the weather report under "Delivered by the vendor". Open the same link again: it shows **Already paid**.

### When something is off

| Symptom | Cause and fix |
| --- | --- |
| `/api/config`: `"reachable":false`, "refused the connection (HTTP 403)" or "Could not reach HSP" | The server's IP is not allowlisted, or it changed. Check `curl -4 ifconfig.me` on the server and ask in the support group. |
| `/api/config`: `"error":"NOD_MERCHANT_NAME is not set…"`, pay routes `503 not_configured` | Set `NOD_MERCHANT_NAME`. |
| `502 no_payment_option` | `NOD_PAY_*` matches no `get_chain_config` option. Clear them or fix the spelling. |
| `502 hsp_error` | HSP returned a tool error; the message carries HSP's text. The server log shows the live tool schemas. |
| `409 quote_expired` | HSP quotes last about 5 minutes. The app prepares a new quote and asks for a new signature. |
| Proof card: "NOD_RECORDER_KEY is not set" or "NOD_RECEIPTS_ADDRESS is not set" | Set the contract address and the recorder key. |
| Proof card: **Anchor failed** | Usually no HSK for gas on the recorder; fund it and press **Try again**. |
| `409 settlement_check_failed` | The on-chain transfer did not match the terms (token, payer, recipient or amount). The response lists the reasons. |
| `502 chain_unavailable` | An RPC endpoint did not answer; set `HSK_MAINNET_RPC`, `HSK_TESTNET_RPC` or `SEPOLIA_RPC`. |
| `500 config_error` | An environment value is invalid; the message names it. |
