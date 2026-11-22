# Deploying Nod (Vercel)

One Vercel project serves the web app and two API functions:

| Path | Source | What it does |
| --- | --- | --- |
| `/`, `/r`, `/tx/...` | `apps/web/src` (Vite build) | The app. Unknown paths fall back to `index.html`. |
| `GET /api/demo-agent` | `apps/web/server/demoAgent.ts` | Signs a fresh demo request and returns its link. |
| `POST /api/vendor/buy` | `apps/web/server/vendor.ts` | Checks the payment on chain and delivers the item. |

`npm run build:vercel` (in `apps/web`) runs `vite build`, then `scripts/build-vercel.mjs`, which writes the [Build Output API v3](https://vercel.com/docs/build-output-api/v3) folder `apps/web/.vercel/output/`:

```
config.json                               routes: filesystem, /api/* 404, SPA fallback to /index.html
static/                                   copy of dist/
functions/api/demo-agent.func/            index.mjs (fully bundled) + .vc-config.json (nodejs22.x)
functions/api/vendor/buy.func/            same
```

Each `index.mjs` inlines every dependency (including `@nod/protocol`, libauth, zod and the Electrum client), so nothing is resolved from `node_modules` at runtime. When `.vercel/output` exists after the build, Vercel deploys it as-is; `config.json` is the routing source of truth (the rewrite in `vercel.json` only matters if that folder is missing). `.vercel/` is in the root `.gitignore`; never commit it.

## 1. Create the project

1. Vercel dashboard > Add New > Project > import the GitHub repo.
2. **Root Directory:** `apps/web`. Leave "Include files outside the root directory" on (the default), because the build needs `packages/protocol`.
3. **Framework Preset:** Other. Build, output and install commands come from `apps/web/vercel.json`:
   - Install: `cd ../.. && npm install` (installs the whole npm workspace from the repo root)
   - Build: `npm run build:vercel`
   - Output: `dist` (ignored when `.vercel/output` is produced, which it always is)
4. **Node.js version:** 22.x (Settings > General). The functions declare `nodejs22.x` themselves.
5. Add the environment variables below, then Deploy.

## 2. Environment variables

Full list with comments: `apps/web/.env.example`. `VITE_*` values are baked into the browser bundle at build time, so redeploy after changing them. `NOD_*` values are read by the functions at runtime and never reach the browser.

| Name | Mainnet demo | Notes |
| --- | --- | --- |
| `VITE_NETWORK` | `mainnet` | `chipnet` by default. Must equal `NOD_NETWORK`. |
| `NOD_NETWORK` | `mainnet` | Falls back to `VITE_NETWORK`, then `chipnet`. |
| `NOD_DEMO_AGENT_KEY` | 64 hex chars | Secret. Unset = ephemeral key per cold start; the response then carries `warning: "ephemeral agent key"`. |
| `NOD_DEMO_VENDOR` | a `bitcoincash:` address the team controls | **Required on mainnet** (otherwise `/api/demo-agent` returns 500). On chipnet, unset = the agent key's own P2PKH address. |
| `NOD_DEMO_SATS` | `2000` | Price per demo purchase, minimum 546. |
| `NOD_PUBLIC_URL` | `https://<project>.vercel.app` | Base of request links, and the origin of the social preview image (`og:image`). Unset = the request's host; the preview falls back to Vercel's production domain. |
| `VITE_SLIDES_URL` | team slide deck link | |
| `VITE_EMBER2026_ADDRESS` | team CashTokens address | |
| `VITE_API_BASE` | (empty) | Only if the API runs on another origin. |

### Generate the agent key

From the repo root (after `npm install`):

```sh
node --input-type=module -e "import{generatePrivateKey,secp256k1,binToHex,hash160,encodeCashAddress}from'@bitauth/libauth';const k=generatePrivateKey();const p=secp256k1.derivePublicKeyCompressed(k);console.log('NOD_DEMO_AGENT_KEY='+binToHex(k));console.log('agent pubkey',binToHex(p),'chipnet self-vendor',encodeCashAddress({prefix:'bchtest',type:'p2pkh',payload:hash160(p)}).address)"
```

Paste the key into Vercel as a Sensitive variable; do not commit it or put it in a `VITE_*` variable. The agent key only signs requests, it never holds funds; the vendor address is where payments land.

## 3. HTTP contract

`GET /api/demo-agent` returns `200 { link, hash, network, expiresAt, request, warning? }` with `Cache-Control: no-store`. `link` is `<base>/r#<payload>`; `request` is the `SignedNodRequest`; `expiresAt` is unix seconds (now + 15 min); the purpose is "1 live weather report". Errors: `500 { error }` (mainnet without `NOD_DEMO_VENDOR`, bad key).

`POST /api/vendor/buy` with `{ txid, signed }` (or `{ txid, payload }`, where `payload` is the link or its `#` part):
- `200 { ok: true, txid, hash, item: { title, body, deliveredAt } }`: signature valid, vendor is the demo vendor, and `verifyReceipt` passes. The item is a live weather report from open-meteo (2 s timeout) with a canned fallback.
- `402 { ok: false, reasons }`: tx not found yet, wrong amount, or wrong memo.
- `400 { error }`: malformed body, bad signature, or a request for another vendor.
- `500 { error }`: no Electrum server answered.
- Stateless: repeating a paid request returns the item again (demo simplification).

## 4. Verify a deployment

```sh
BASE=https://<project>.vercel.app
curl -s $BASE/api/demo-agent            # 200 JSON with link; no "warning" when NOD_DEMO_AGENT_KEY is set
curl -s -o /dev/null -w '%{http_code}\n' $BASE/r          # 200 (SPA fallback)
curl -s -o /dev/null -w '%{http_code}\n' $BASE/tx/abc     # 200 (SPA fallback)
curl -s -X POST $BASE/api/vendor/buy -d '{}'              # 400 {"error":"txid must be 64 hex characters"}
```

Then open the `link` from the first call in a browser: the approval page should show the request with a valid signature and the network badge you expect. Pay it from a wallet, and the receipt page should show the delivered weather report.

## 5. Local

```sh
cd apps/web
cp .env.example .env.local      # optional; chipnet works with nothing set
npm run dev                     # app + /api/* on http://localhost:5173 (same handlers, via vite middleware)
npm test                        # handler tests (mocked chain, no network)
npm run build:vercel            # writes .vercel/output
```

To prove a function bundle is self-contained, copy `apps/web/.vercel/output/functions/api/demo-agent.func/` to an empty folder outside the repo and run:

```sh
node --input-type=module -e "import h from './demo-agent.func/index.mjs';import http from 'node:http';http.createServer(h).listen(8787)"
curl -s localhost:8787/api/demo-agent
```

## 6. Deploy from a laptop (what Nod uses)

The live site is **https://nod-bch.vercel.app** (Vercel project `nod-bch`, scope `aagneye-s-team`). It is deployed **prebuilt**: the Build Output folder is built locally and uploaded as-is, so Vercel never runs `npm install` on a lockfile that was generated on Windows (it can miss Linux native bindings for rolldown and tailwind).

```sh
cd apps/web
npx vercel@latest login                          # once per machine, approve in the browser
npx vercel@latest link --yes --project nod-bch   # writes .vercel/project.json (git-ignored)
NOD_PUBLIC_URL=https://nod-bch.vercel.app npm run build:vercel
npx vercel@latest deploy --prebuilt --prod --yes
```

- `VITE_*` variables come from **your shell** at build time (they are baked into the bundle). `NOD_*` variables are read by the functions at **runtime** from the Vercel project's Production environment.
- Only the production domain `nod-bch.vercel.app` is public. Per-deployment URLs (`nod-<hash>-aagneye-s-team.vercel.app`) sit behind Vercel Authentication, so never share them with judges.
- After a deploy, run the checks in section 4 against `https://nod-bch.vercel.app`.

### Switching the live site to mainnet

1. Add the runtime variables to the project (Production), then redeploy:
   ```sh
   npx vercel@latest env add NOD_NETWORK production        # value: mainnet
   npx vercel@latest env add NOD_DEMO_VENDOR production    # a bitcoincash: address the team controls
   npx vercel@latest env add NOD_DEMO_AGENT_KEY production # 64 hex chars, see "Generate the agent key"; mark Sensitive
   npx vercel@latest env add NOD_DEMO_SATS production      # about $0.01 in sats at today's price
   ```
2. Rebuild with the public values in your shell and deploy (PowerShell shown):
   ```powershell
   $env:VITE_NETWORK='mainnet'; $env:VITE_EMBER2026_ADDRESS='bitcoincash:z...'; $env:VITE_SLIDES_URL='https://docs.google.com/presentation/d/.../view'; $env:NOD_PUBLIC_URL='https://nod-bch.vercel.app'; npm run build:vercel
   npx vercel@latest deploy --prebuilt --prod --yes
   ```
3. `GET /api/demo-agent` must now return `"network":"mainnet"`, a vendor starting with `bitcoincash:`, and no `warning`.
