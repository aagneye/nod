# Nod: DoraHacks submission

Everything to paste into the DoraHacks BUIDL form for the **HSK Chain Horizon Hackathon · Seoul**, track **Agent Payments & A2A Settlement (HSP)**. Deadline: **Dec 3, 2026, 13:00 KST** (09:30 IST). Late submissions are rejected.

Placeholders to fill before submitting: `<LIVE_URL>`, `<VIDEO_URL>`, `<NODRECEIPTS_MAINNET>`, `<NODPOLICY_MAINNET>`, `<HSP_TEST_PAYMENT_TX>`, `<TEAM>`.

## Form fields

| Field | Value |
| --- | --- |
| Name | Nod |
| One-line description (109 characters) | Agents sign payment terms, you approve in your wallet, HSP settles, and Nod anchors the receipt on HSK Chain. |
| Track | Agent Payments & A2A Settlement (HSP) |
| Tags | AI Agents, Payments, HSP, HSK Chain, MCP, EIP-712, Stablecoins, A2A |
| Live demo | `<LIVE_URL>` |
| Video | `<VIDEO_URL>` |
| Code | https://github.com/aagneye/nod |
| Contracts on HSK Chain mainnet (chain 177) | NodReceipts `<NODRECEIPTS_MAINNET>`, NodPolicy `<NODPOLICY_MAINNET>` |
| HSP payment | `<HSP_TEST_PAYMENT_TX>` |
| Team | `<TEAM>` |

## Description

Paste the block below as markdown.

````markdown
# Nod

**Your agent asks. You nod. HSK Chain settles.**

Nod lets an AI agent ask for a payment without holding any money. The agent signs the terms, a person approves them in their own wallet, HSP settles the payment, and Nod anchors a receipt on HSK Chain that ties the payment to the exact terms.

## Problem

AI agents are starting to pay for things: API calls, data, small digital goods. Giving an agent a wallet means a bug or a prompt injection can spend your money. Paying by hand loses the link between what the agent asked for and what was paid: the seller cannot tell which request was paid, and nobody can check it later.

## How it works

1. **The agent asks.** It signs payment terms with EIP-712 (merchant, recipient, amount in USD, purpose, expiry) using a key that holds no funds, and shares a link.
2. **You nod.** The Nod app checks the signature, the expiry, and whether the terms were already paid. The server creates an HSP order from the terms and asks HSP to prepare the payment. You see HSP's exact token quote and sign HSP's EIP-712 authorization in OKX Wallet or MetaMask.
3. **HSP settles.** The server finalizes and submits the payment through HSP Agentic Payment. HSP's Gateway executes the transfer, and the app shows every HSP status.
4. **Proof on HSK Chain.** The server checks the ERC-20 transfer on chain and anchors `termsHash → settlement` in the NodReceipts contract on HSK Chain mainnet. The seller agent checks the payment before it delivers. Opening the same link again shows "Already paid".

**Without a nod:** the NodPolicy contract lets an owner give an agent a spending cap per period, in one token, for chosen payees. The agent pays directly within the cap, and the owner can revoke it at any time.

## Key features

- **Signed terms.** EIP-712 with an expiry, carried in the link's URL fragment, so no server stores them.
- **HSP end to end.** `get_chain_config` → `create_order` → `prepare_payment` → wallet signature → `finalize_payment` → `submit_payment` → `query_payment`, over MCP. Nod never builds payment payloads itself. It fits its arguments to HSP's live tool schemas and prepares a fresh quote when one expires.
- **Checks before you sign.** The app compares HSP's quote with the signed terms and will not sign a quote that pays a different address.
- **Independent settlement check.** Before anchoring, the server finds the token transfer from the payer to the recipient, for at least the amount, in the transaction receipt.
- **Receipts on HSK Chain.** NodReceipts stores receipts per recorder, so nobody can block or overwrite them. It stops double payment, and anyone can verify which settlement paid which terms.
- **Spending caps.** NodPolicy sets per-agent caps per period, payee allowlists and instant revoke. Funds stay in the owner's wallet until a payment happens.
- **Agent tools.** A `nod-agent` CLI and an MCP server (`nod_request_payment`, `nod_payment_status`, `nod_list_requests`) for Claude Code, Claude Desktop or any MCP client.
- **A seller agent.** The demo weather agent signs its own terms and delivers a live weather report only after it has verified the payment.
- **Wallets.** OKX Wallet, MetaMask and any EIP-6963 wallet. The app switches the wallet to the chain HSP's authorization is for, and adds it if needed.
- **Built around HSP's IP allowlist.** A standalone server (or Docker image) runs the HSP calls on a fixed IP; the static app on Vercel forwards `/api` to it.

## Tech stack

TypeScript and viem; Solidity 0.8.28 with OpenZeppelin and Hardhat; React, Vite and Tailwind CSS; the MCP TypeScript SDK as the client of HSP Agentic Payment; Node.js; Vitest and Hardhat tests.

## How Nod meets the track

| Requirement | Nod |
| --- | --- |
| Use HSP for payments | Every approved payment runs through HSP Agentic Payment: `create_order`, `prepare_payment`, `finalize_payment`, `submit_payment`, `query_payment`. Example payment: `<HSP_TEST_PAYMENT_TX>` |
| Build on HSK Chain | Receipts are anchored in NodReceipts on HSK Chain, NodPolicy is deployed there, and the app reads both and links HSK Chain's explorer. When HSP offers HSK Chain testnet USDC, Nod pays with it by default; `NOD_PAY_CHAIN_ID=177` picks HSK Chain mainnet when HSP offers it. |
| Smart contract on HSK Chain mainnet | NodReceipts `<NODRECEIPTS_MAINNET>` and NodPolicy `<NODPOLICY_MAINNET>` on chain 177, verified on hsk.blockscout.com |
| Agent payments and A2A settlement | A buying agent asks for a payment through Nod's MCP server or CLI. The selling agent signs its own terms and checks HSP's status and the on-chain transfer before it delivers. Any agent can read the receipt (`nod_payment_status`). NodPolicy lets an agent pay another agent within a cap its owner set. |

## Links

- Live demo: `<LIVE_URL>`
- Video: `<VIDEO_URL>`
- Code: https://github.com/aagneye/nod
- Team: `<TEAM>`

Idea inspired by Requisition (https://dorahacks.io/build/50833).
````

## Demo Day pitch outline

1. **Problem.** Agents need to pay for things. Keys inside an agent can be drained, and paying by hand proves nothing about what the agent asked for.
2. **Nod in one line.** The agent signs the terms, you nod with one wallet signature, HSP settles, and NodReceipts on HSK Chain records which terms were paid.
3. **Live demo.** Try the demo → HSP quote → Sign in wallet → Paid via HSP → Transfer verified and Anchored → weather report delivered → "Already paid" on the second try. Then Claude asks for a payment through the MCP server.
4. **Why it holds up.** Signature and expiry are checked before the wallet opens, the quote is matched to the terms, the transfer is checked on chain, receipts are kept per recorder, and NodPolicy caps small agent-to-agent payments.
5. **Business and next steps.** The protocol is open. Revenue comes from a small fee on Nod-settled payments with a receipt API for vendors, and a team console for spending policies, approvals and audit export. Next: NodPolicy screens in the app, and more networks as HSP adds them.

## Pre-submit checklist

Done:

- [x] Protocol, contracts, server, web app and agent tools built; `npm test` passes.
- [x] README, DEPLOY, DEMO and this file written.

To do:

- [ ] HSP has allowlisted the server's public IP; `/api/config` shows `"reachable": true`.
- [ ] `NOD_MERCHANT_NAME` is set to the team's HSP reporting name.
- [ ] First real HSP payment done end to end; its settlement transaction is saved as `<HSP_TEST_PAYMENT_TX>`.
- [ ] NodReceipts and NodPolicy deployed on HSK Chain mainnet and verified on Blockscout; `<NODRECEIPTS_MAINNET>` and `<NODPOLICY_MAINNET>` filled in here and in the README.
- [ ] The server uses the mainnet contracts (`NOD_RECEIPTS_CHAIN=hsk-mainnet`, a funded `NOD_RECORDER_KEY`), and a payment shows **Anchored** with an anchor transaction on hsk.blockscout.com.
- [ ] The standalone server runs on the allowlisted machine, `<LIVE_URL>` is deployed, the checks in `docs/DEPLOY.md` section 6 pass, and no "Simulation mode" banner shows.
- [ ] `NOD_DEMO_AGENT_KEY` and `NOD_DEMO_VENDOR` are set (no "ephemeral agent key" warning from `/api/demo-agent`).
- [ ] Video recorded from `docs/DEMO.md` and uploaded; `<VIDEO_URL>` filled in.
- [ ] Repo public, README placeholders replaced, `<TEAM>` filled in.
- [ ] BUIDL submitted to the track before Dec 3, 2026, 13:00 KST.
- [ ] Registered for Demo Day in Seoul on Dec 5 (demo selection is announced Dec 4).
