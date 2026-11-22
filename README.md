# Nod

> **Your agent asks. You nod. BCH settles.**

Nod is not another AI agent. It is the **approval and payment layer any agent can use**: the agent signs a payment request, you approve it with one tap in your own Bitcoin Cash wallet, and the money goes straight to the vendor with an on-chain receipt that points at the exact request you approved.

**Live demo:** https://nod-bch.vercel.app · **Video:** `<VIDEO_URL>` · **Slides:** `<SLIDES_URL>` · Built for [BCH BLAZE 2026](https://dorahacks.io/hackathon/bchblaze2026/detail)

## Why

AI agents are starting to buy things: API calls, data, compute, small digital goods. Today there are two bad options:

- **Give the agent a wallet.** Now a prompt injection or a bug can spend your money. Keys in an agent's environment are keys you have already half lost.
- **Pay by hand.** The agent says "please send 0.0001 BCH to this address", you copy it into a wallet, and nothing links the payment to what the agent asked for. The vendor cannot tell which request you paid, and you cannot audit later what you approved.

Nod keeps the keys with the human and makes every payment provably tied to the request it settles.

## How it works

1. **The agent asks.** It signs a small Nod Request (vendor, amount, purpose, expiry) with its own key, which holds no money, and sends you a link.
2. **You nod.** The link opens an approval page that checks the signature and expiry and whether it was already paid. You approve with one tap in your own wallet over **WizardConnect** (Paytaca, Selene). Several requests can be approved in **one batch**.
3. **BCH settles.** One BCH transaction pays the vendor directly and carries an `OP_RETURN "NOD"` memo with the hash of the signed request. Anyone (you, the agent, the vendor) can check on-chain that *this* request was paid, with no server and no database.

Optional: a CashScript **allowance covenant** (`contracts/`) lets an agent spend up to X sats per N blocks to one vendor on its own, and you can cancel it at any time.

## Architecture

```
Agent (Claude via MCP, CLI, or any HTTP agent)
   │ signs Nod Request (agent key, no funds)
   ▼
https://<app>/r#<base64url {req, sig}>        stateless link
   ▼
Web app ── verify signature, expiry, not already paid
   │ builds tx (libauth) ◄── UTXOs from public Fulcrum servers (Electrum over WSS)
   │ WizardConnect signTransaction ◄──► your phone wallet
   ▼
BCH tx: vendor output(s) + OP_RETURN "NOD" <request hash> + change
   ▼
Receipt page / agent / vendor ── re-fetch tx, check vendor + amount + memo hash
```

| Path | What it is |
|---|---|
| [`packages/protocol`](packages/protocol) | Nod Request format, Schnorr signing, links, Electrum client, transaction builder, receipt checks |
| [`packages/agent`](packages/agent) | `nod-agent` CLI and MCP server so any agent can create requests and check payment |
| [`apps/web`](apps/web) | React web app: approval, batch and receipt pages, WizardConnect, demo agent and demo vendor API |
| [`contracts`](contracts) | CashScript allowance covenant with tests |
| [`docs`](docs) | [Protocol spec](docs/PROTOCOL.md), [deploy](docs/DEPLOY.md), [demo script](docs/DEMO.md), [submission](docs/SUBMISSION.md), [plan](docs/PLAN.md) |

## Quickstart

Requires Node.js 22.

```bash
npm install
npm test                       # protocol, contracts, agent tests
npm run dev -w @nod/web        # web app + demo API on http://localhost:5173
```

Chipnet (BCH testnet) is the default everywhere. Get test coins from [tbch.googol.cash](https://tbch.googol.cash).

### Agent CLI

```bash
node packages/agent/build.mjs  # bundles dist/cli.mjs and dist/mcp.mjs

node packages/agent/dist/cli.mjs key
node packages/agent/dist/cli.mjs request \
  --vendor bchtest:qr4upmst92u7sfm6vqxz29r4ug4rysdpcytc853pps \
  --sats 1000 --purpose "1 weather API call" --expiry 1h
node packages/agent/dist/cli.mjs status <id>
node packages/agent/dist/cli.mjs list
```

| Variable | Default | Meaning |
|---|---|---|
| `NOD_NETWORK` | `chipnet` | `chipnet` or `mainnet` |
| `NOD_BASE_URL` | `http://localhost:5173` | Web app that renders approval links (`--app-url` overrides) |
| `NOD_AGENT_KEY` | `~/.nod/agent.key` | 64-hex agent signing key; created on first use if absent |
| `NOD_HOME` | `~/.nod` | Where the key and `requests.json` live |
| `NOD_AGENT_NAME` | `Nod agent` | Label shown to the approver |

### MCP server (Claude Desktop, Claude Code)

Build once (`node packages/agent/build.mjs`), then add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nod": {
      "command": "node",
      "args": ["/absolute/path/to/nod/packages/agent/dist/mcp.mjs"],
      "env": {
        "NOD_NETWORK": "chipnet",
        "NOD_BASE_URL": "https://nod-bch.vercel.app",
        "NOD_AGENT_NAME": "Claude"
      }
    }
  }
}
```

Claude Code: `claude mcp add nod -e NOD_NETWORK=chipnet -e NOD_BASE_URL=https://nod-bch.vercel.app -- node /absolute/path/to/nod/packages/agent/dist/mcp.mjs`

Tools: `nod_request_payment` (returns the approval link), `nod_payment_status` (paid / unpaid / expired, with txid), `nod_list_requests`. The server is plain JSON-RPC over stdio with no SDK dependency.

## Hackathon requirements

- Runs on **Bitcoin Cash mainnet**; chipnet for testing.
- Wallet connection through **WizardConnect**.
- The top-of-page banner on the live app links the **slides** (Widget Factory template), this **repo**, and our **CashTokens address for EMBER2026** votes.

## Credits

Inspired by [Requisition](https://dorahacks.io/build/50833) (agents request purchases, a human approves). Nod is a new codebase for Bitcoin Cash. It adds signed requests, on-chain receipts linked to the exact request, batch approval, an MCP and CLI agent tool, and an optional allowance covenant.

Built with [libauth](https://github.com/bitauth/libauth), [@electrum-cash/network](https://gitlab.com/electrum-cash/network), WizardConnect, and [CashScript](https://cashscript.org).

## License

MIT
