# Nod: build plan

> *"Your agent asks. You nod. HSK Chain settles."*

## Target

**HSK Chain Horizon Hackathon · Seoul**, track **Agent Payments & A2A Settlement (HSP)**.

- Submission deadline: **December 3, 2026, 13:00 KST** (09:30 IST). Late submissions are rejected.
- Demo selection announced December 4; Demo Day in Seoul on December 5; winners December 6.
- Prize pool for the track: 6,000 USDT (3,000 / 2,000 / 1,000).

| Rule | How Nod meets it |
| --- | --- |
| Build on HSK Chain | Contracts on HSK Chain; HSP settlement; app and agent tools target HSK Chain |
| Use HSP for the payment track | Every human-approved payment runs through HSP Agentic Payment (create_order, prepare, wallet signature, finalize, submit, query) |
| Smart contract on HSK Chain mainnet (required for demo selection) | `NodReceipts` and `NodPolicy` deployed to chain 177 and linked from the app |
| Officially recommended products earn bonus points | HSP, OKX Wallet support in the browser, Claude Code / MCP agents as in HSP's own guide |
| Original, built or rebuilt during the hackathon | This codebase |

## Progress (last updated Nov 22, 2026)

| Area | Status |
| --- | --- |
| Protocol v2 spec (`docs/PROTOCOL.md`) | Done |
| Contracts: `NodReceipts`, `NodPolicy` (`contracts/`) | Done (tests pass; not deployed yet) |
| Protocol package on viem (`packages/protocol`) | Done |
| Server: HSP MCP client, demo agent, vendor (`apps/web/server`) | Done (mock HSP tested; live HSP waits for the allowlist) |
| Web app: wallet, approval, status, receipt (`apps/web/src`) | Done |
| Agent CLI and MCP tools (`packages/agent`) | Done |
| Docs: README, deploy, demo, submission, steps | Done |
| HSP QA IP allowlist | Owner action, not started |
| Merchant name (`NOD_MERCHANT_NAME`) | Owner action, not started |
| Testnet deploy, then mainnet deploy | Owner action, not started |
| First real HSP payment | Owner action, not started |
| Standalone server on a fixed IP, app on Vercel | Owner action, not started |
| Demo video, DoraHacks submission, Demo Day registration | Owner action, not started |

## Architecture

1. **The agent asks.** A receiving agent (the demo vendor sells a live weather report) signs payment terms with EIP-712: merchant, recipient, amount in USD, purpose, expiry. It shares a link: `/r#<terms>`.
2. **You nod.** The Nod app verifies the agent's signature and expiry, and checks whether the terms were already paid. Connect a wallet (OKX Wallet, MetaMask or any EIP-6963 wallet). The server creates an HSP order from the terms and asks HSP to prepare the payment; the wallet signs HSP's EIP-712 authorization.
3. **HSK Chain settles.** The server finalizes and submits through HSP; HSP's Gateway broadcasts the transfer. The app follows the payment until `payment-safe` or `payment-finalized`.
4. **Proof.** The server checks the token transfer on chain and anchors `termsHash -> settlement tx` in `NodReceipts` on HSK Chain. The vendor then delivers the item.
5. **Without a nod.** `NodPolicy` lets an owner give an agent a spending cap per period for chosen payees; the agent pays directly within it, and the owner can revoke at any time.

| Package | Contents |
| --- | --- |
| `packages/protocol` | Terms (EIP-712), links, HSP cart and response helpers, settlement check, contract ABIs, chain config |
| `contracts` | `NodReceipts`, `NodPolicy` (Solidity, Hardhat), tests, deploy scripts |
| `apps/web` | React app plus API: `/api/demo-agent`, `/api/pay/*` (HSP), `/api/vendor/buy` |
| `packages/agent` | `nod-agent` CLI and MCP server for agents that ask for payments |

**Where the HSP calls run:** HSP QA only accepts allowlisted public IPs, and Vercel functions have no fixed IP. The `/api/pay/*` routes therefore run in a standalone Node server on a machine with a fixed public IP (a small VPS, or the team's machine for the demo). The static app can stay on Vercel and point at it with `VITE_API_BASE`.

## Owner actions (critical path)

1. Send the HSP team the public IP of the machine that will run the server, through the support group linked on the hackathon page. Wait for their confirmation.
2. Choose the team's HSP reporting name (`NOD_MERCHANT_NAME`) and use it everywhere.
3. Create a deployer wallet; get testnet HSK from https://faucet.hsk.xyz/faucet and a little mainnet HSK for the mainnet deploy.
4. Fund a payer wallet with the test token HSP's `get_chain_config` returns (Circle test USDC on Sepolia from the Circle faucet, or HSK Chain testnet tokens).
5. Record the demo video, write the DoraHacks submission, and register for Demo Day.

## Schedule

| Date | Goal |
| --- | --- |
| Nov 22 | Spec, contracts, protocol, server, web app, agent tools; tests green |
| Nov 23-24 | HSP allowlist confirmed; first real HSP payment on test tokens |
| Nov 25-26 | Contracts on HSK testnet, then mainnet; anchors live |
| Nov 27-29 | Polish, demo video, docs |
| Nov 30-Dec 2 | Submission text, final checks, buffer |
| Dec 3, 13:00 KST | Submission closes |

## Risks

- **HSP allowlisting is slow.** Ask on day one. Mock mode exists for development only; the live demo must use real HSP.
- **Tool schemas differ from the guide.** The server reads tool results defensively and logs the live schemas on start.
- **Wallet rejects typed-data signing on the wrong chain.** The app switches the wallet to the chain in HSP's EIP-712 domain before signing.
