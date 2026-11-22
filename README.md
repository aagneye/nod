# Nod

> **Your agent asks. You nod. HSK Chain settles.**

Nod lets an AI agent ask for a payment without holding any money. The agent signs the payment terms. You approve them in your own wallet. HSP (HashKey Settlement Platform) moves the stablecoin. Nod then anchors a receipt on HSK Chain that ties the payment to the exact terms you approved.

**Live demo:** `<LIVE_URL>` · **Video:** `<VIDEO_URL>` · **Track:** HSK Chain Horizon Hackathon · Seoul, Agent Payments & A2A Settlement (HSP)

## The problem

AI agents are starting to pay for things: API calls, data, small digital goods. Today there are two bad options.

- **Give the agent a wallet.** A bug or a prompt injection can then spend your money.
- **Pay by hand.** The agent asks you to send money to an address and you copy it into a wallet. Nothing links the payment to what the agent asked for. The seller cannot tell which request was paid, and you cannot check later what you approved.

Nod keeps the money with the person and links every payment to the terms it pays.

## How it works

1. **The agent asks.** It signs payment terms with EIP-712: merchant, recipient, amount in USD, purpose and expiry. Its key holds no funds. It sends you a link, `<app>/r#<signed terms>`.
2. **You nod.** The app checks the signature, the expiry, and whether the terms were already paid. You connect your wallet (OKX Wallet, MetaMask or any EIP-6963 wallet). The Nod server creates an HSP order from the terms and asks HSP to prepare the payment. HSP returns the exact token amount and an EIP-712 authorization, and your wallet signs it.
3. **HSP settles.** The server finalizes and submits the payment through HSP, and HSP's Gateway executes the token transfer. The app shows every HSP status until `payment-safe` or `payment-finalized`.
4. **Proof on HSK Chain.** The server checks the transfer on chain (right token, from the payer, to the recipient, at least the amount) and anchors `termsHash → settlement` in the `NodReceipts` contract on HSK Chain. The demo seller agent checks the payment the same way before it delivers.

**Without a nod.** The `NodPolicy` contract lets an owner give an agent a spending cap per period, in one token, for chosen payees. The agent then pays directly within the cap, and the owner can revoke it at any time. NodPolicy is a contract with tests; the app has no screen for it yet.

The payment network and token come from HSP's `get_chain_config`. Nod prefers HSK Chain testnet USDC when HSP offers it, otherwise the first USDC option. For this hackathon the faucet page points to Circle test USDC on Sepolia.

HSP only accepts calls from allowlisted public IPs. So the HSP calls run in a standalone Node server on a machine with a fixed IP. The static app can stay on Vercel and forward `/api` to that server. See [docs/DEPLOY.md](docs/DEPLOY.md).

```
Agent (Claude via MCP, the CLI, or any HTTP client)
  │ signs EIP-712 terms with a key that holds no funds
  ▼
<app>/r#<signed terms>                    the terms ride in the URL fragment
  ▼
Web app ── checks signature, expiry, and NodReceipts (already paid?)
  │ POST /api/pay/start   →  HSP get_chain_config, create_order, prepare_payment
  │ wallet signs HSP's EIP-712 authorization (eth_signTypedData_v4)
  │ POST /api/pay/finish  →  HSP finalize_payment, submit_payment
  │ GET  /api/pay/status  →  HSP query_payment, every 3 s
  ▼
HSP Gateway executes the token transfer
  ▼
POST /api/pay/settle   checks the ERC-20 Transfer on chain → NodReceipts.anchor on HSK Chain
POST /api/vendor/buy   the demo seller agent checks the payment and delivers a weather report
```

## Repo layout

| Path | What it is |
| --- | --- |
| [`packages/protocol`](packages/protocol) | Signed terms (EIP-712) and links, HSP cart and result helpers, settlement check, contract ABIs, chain config (viem) |
| [`contracts`](contracts) | `NodReceipts` and `NodPolicy` (Solidity 0.8.28, Hardhat, OpenZeppelin), tests, deploy and ABI export scripts |
| [`apps/web`](apps/web) | React app (Vite) and the `/api` server: HSP MCP client, mock HSP, settlement check, receipt anchoring, demo seller agent. Runs as Vite dev middleware, a standalone Node server (or Docker), or Vercel functions |
| [`packages/agent`](packages/agent) | `nod-agent` CLI and an MCP server (stdio) for agents that ask for payments |
| [`docs`](docs) | [Protocol](docs/PROTOCOL.md), [deploy](docs/DEPLOY.md), [demo](docs/DEMO.md), [submission](docs/SUBMISSION.md), [plan](docs/PLAN.md), [steps](docs/STEPS.md) |

## Quickstart

Requires Node.js 22.12 or later.

```bash
npm install
npm test        # protocol, agent, server and contract tests (Hardhat fetches solc 0.8.28 on the first run)
```

### Run the app locally with mock HSP

Your machine is probably not on HSP's allowlist, so run HSP in mock mode for local development. Mock mode simulates HSP in memory: Sepolia test USDC, a fake settlement transaction, no on-chain check and no receipt anchor.

```bash
HSP_MODE=mock npm run dev -w @nod/web          # bash
```

```powershell
$env:HSP_MODE='mock'; npm run dev -w @nod/web  # PowerShell
```

You can also put `HSP_MODE=mock` in `apps/web/.env.local`; [`apps/web/.env.example`](apps/web/.env.example) lists every variable. Open http://localhost:5173 and press **Try the demo**. The banner "Simulation mode — no real payment" confirms that nothing is paid. Your wallet still signs a real EIP-712 authorization, but nothing is broadcast.

### Run with real HSP

Use a machine whose public IP the HSP team has allowlisted. Set `NOD_MERCHANT_NAME` (your team's HSP reporting name) in `apps/web/.env.local`; `HSP_MODE` defaults to `live`.

```bash
npm run serve -w @nod/web      # builds the app if needed, then serves the app and /api on http://localhost:8787
```

`npm run dev -w @nod/web` also talks to real HSP when it runs on an allowlisted machine. Contracts, environment variables, Docker and Vercel: [docs/DEPLOY.md](docs/DEPLOY.md).

## Agent tools: CLI and MCP server

`packages/agent` lets any agent ask a person for a payment and check later whether it was paid.

```bash
npm run build -w @nod/agent    # writes packages/agent/dist/cli.mjs and dist/mcp.mjs

node packages/agent/dist/cli.mjs key
node packages/agent/dist/cli.mjs request --pay-to 0xRecipientAddress --usd 0.10 --purpose "1 weather report" --expires 1h
node packages/agent/dist/cli.mjs status <termsHash or id>
node packages/agent/dist/cli.mjs list
```

`request` also takes `--merchant "<name>"` and `--app-url <url>`; every command takes `--json`. `status` asks `GET <NOD_BASE_URL>/api/receipt`: terms count as paid once the server's recorder has anchored them in NodReceipts.

| Variable | Default | Meaning |
| --- | --- | --- |
| `NOD_BASE_URL` | `http://localhost:5173` | Nod app for approval links and status checks |
| `NOD_AGENT_KEY` | `~/.nod/agent.key` | Agent private key (64 hex). Created on first use when absent. It only signs terms. |
| `NOD_HOME` | `~/.nod` | Folder for `agent.key` and `terms.json` (the terms this agent created) |
| `NOD_AGENT_NAME` | `Nod agent` | Merchant name shown to the payer when `--merchant` is not given |

Run the bundles from a checkout where `npm install` has run: they load viem from the repo's `node_modules`.

### MCP config for Claude Code and Claude Desktop

Build once (`npm run build -w @nod/agent`), then register `packages/agent/dist/mcp.mjs` with an absolute path.

Claude Code:

```bash
claude mcp add nod -e NOD_BASE_URL=<LIVE_URL> -e NOD_AGENT_NAME=Claude -- node /absolute/path/to/nod/packages/agent/dist/mcp.mjs
```

Claude Desktop (`claude_desktop_config.json`; on Windows write the path as `C:\\path\\to\\nod\\packages\\agent\\dist\\mcp.mjs`):

```json
{
  "mcpServers": {
    "nod": {
      "command": "node",
      "args": ["/absolute/path/to/nod/packages/agent/dist/mcp.mjs"],
      "env": {
        "NOD_BASE_URL": "<LIVE_URL>",
        "NOD_AGENT_NAME": "Claude"
      }
    }
  }
}
```

| Tool | Input | Result |
| --- | --- | --- |
| `nod_request_payment` | `payTo`, `amountUsd`, `purpose`, optional `merchant`, optional `expiresIn` (`30m`, `1h` default, `2d`) | Approval link and `termsHash` |
| `nod_payment_status` | `termsHash` (or `id`) | `paid`, `unpaid`, `expired` or `unknown`, with the settlement transaction once paid |
| `nod_list_requests` | none | The terms this agent created, newest first |

The MCP server speaks newline-delimited JSON-RPC over stdio and has no SDK dependency.

## Contracts

| Contract | HSK Chain mainnet (chain 177) | HSK Chain testnet (chain 133) |
| --- | --- | --- |
| `NodReceipts` | `<NODRECEIPTS_MAINNET>` | `<NODRECEIPTS_TESTNET>` |
| `NodPolicy` | `<NODPOLICY_MAINNET>` | `<NODPOLICY_TESTNET>` |

Explorers: https://hsk.blockscout.com (mainnet) and https://testnet-explorer.hskchain.net (testnet). The deploy script records each deployment in `contracts/deployments/<network>.json`; ABIs are in [`contracts/abi`](contracts/abi).

- **NodReceipts.** `anchor(termsHash, settlementTx, chainId, payer, payTo, amount)` records which settlement paid which terms; `anchorBatch` records several at once. Receipts are namespaced by recorder (`msg.sender`), so nobody can block or overwrite another recorder's receipt. `receiptOf` and `isAnchored` let anyone check.
- **NodPolicy.** The owner approves the contract for an ERC-20 token, then calls `setPolicy(agent, token, cap, period)` and `allowPayee(agent, payee, true)`. The agent calls `pay(owner, token, payee, amount, termsHash)`, which moves tokens with `safeTransferFrom` within the cap for the current period. `revoke(agent, token)` stops it at once.

Full spec: [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Credits

Idea inspired by [Requisition](https://dorahacks.io/build/50833).

Payments run through HSP (HashKey Settlement Platform). Built with viem, the MCP TypeScript SDK, OpenZeppelin Contracts, Hardhat, React and Vite.

## License

MIT
