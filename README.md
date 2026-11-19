# Nod

> **Your agent asks. You nod. BCH settles.**

Nod lets an AI agent request a purchase without holding any money. The agent signs a small request (vendor, amount, purpose, expiry). A person opens the link, checks it, and approves the payment from their own wallet over WizardConnect. The money goes straight to the vendor on Bitcoin Cash mainnet, and the payment carries an on-chain fingerprint of the request as a receipt.

Built for [BCH BLAZE 2026](https://dorahacks.io/hackathon/bchblaze2026/detail). Inspired by [Requisition](https://dorahacks.io/build/50833), rebuilt for Bitcoin Cash with batch payments, on-chain receipts, PUSD stablecoin support and an agent tool.

## Repository layout

| Path | What it is |
|---|---|
| `packages/protocol` | Nod Request format, signing, Electrum client, transaction builder, receipt checks |
| `contracts` | CashScript allowance contract (stretch) |
| `packages/agent` | MCP server and CLI for agents |
| `apps/web` | React web app (approval and receipt pages) |
| `api` | Demo agent and demo vendor endpoints |
| `docs` | [Plan](docs/PLAN.md), [steps](docs/STEPS.md), [protocol spec](docs/PROTOCOL.md) |

## Development

```bash
npm install
npm test
```

Requires Node.js 20 or newer.

## License

MIT
