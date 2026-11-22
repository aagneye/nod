# Nod: remaining steps

Last updated Nov 22, 2026. Submission closes **Dec 3, 2026, 13:00 KST** (09:30 IST). Demo Day is in Seoul on Dec 5.

The build is done. What is left are owner actions: they need accounts, keys, funds or the HSP team. Do them in this order.

## Done

- [x] Protocol spec: [`docs/PROTOCOL.md`](PROTOCOL.md)
- [x] Contracts: `NodReceipts` and `NodPolicy` with tests, deploy, verify and ABI export scripts (`contracts/`)
- [x] Protocol package: signed terms and links, HSP cart and result helpers, settlement check, ABIs, chain config (`packages/protocol`)
- [x] Server: HSP MCP client, mock HSP, pay routes, settlement check, receipt anchoring, demo seller agent; standalone server, Docker image and Vercel build (`apps/web/server`, `apps/web/scripts`)
- [x] Web app: wallet picker (EIP-6963), approval page, HSP quote, status timeline, receipt with proof and delivery, live status panel, How it works page (`apps/web/src`)
- [x] Agent tools: `nod-agent` CLI and MCP server (`packages/agent`)
- [x] Docs: README, [DEPLOY](DEPLOY.md), [DEMO](DEMO.md), [SUBMISSION](SUBMISSION.md)
- [x] `npm test` passes (protocol, agent, server, contracts)

## Owner actions, in order

1. [ ] **HSP allowlist.** Pick the machine that will run the standalone server (fixed public IP). Send its public egress IP to the HSP team in the support group https://t.me/+o8jNDBE_cf44NWFl and wait for their confirmation. Check: `/api/config` on that machine shows `"reachable": true`. Details: [DEPLOY.md section 1](DEPLOY.md#1-hsp-allowlist).
2. [ ] **Merchant name.** Choose the team's HSP reporting name and set it as `NOD_MERCHANT_NAME` on every server. Use the same name everywhere.
3. [ ] **Wallets and tokens.**
   - Deployer key: testnet HSK from https://faucet.hsk.xyz/faucet, plus a little mainnet HSK for the mainnet deploy.
   - Recorder key (`NOD_RECORDER_KEY`): a separate key with a little HSK on the receipts chain.
   - Demo agent key (`NOD_DEMO_AGENT_KEY`) and a team address for `NOD_DEMO_VENDOR`.
   - Payer wallet (OKX Wallet or MetaMask) funded with the test token HSP's `get_chain_config` returns: Circle test USDC on Sepolia ([DEMO.md](DEMO.md#what-the-payer-needs)).
4. [ ] **Testnet deploy.** `npm run deploy:hsk-testnet -w @nod/contracts`, verify with `npx hardhat verify --network hskTestnet <address>` (from `contracts/`), then set `NOD_RECEIPTS_ADDRESS`, `NOD_POLICY_ADDRESS` and `NOD_RECORDER_KEY` on the server with `NOD_RECEIPTS_CHAIN=hsk-testnet`.
5. [ ] **First real HSP payment.** On the allowlisted server: **Try the demo** → **Nod — approve payment** → **Sign in wallet**. Expect **Paid via HSP**, **Transfer verified**, **Anchored** (on testnet) and the weather report. Save the settlement transaction for `<HSP_TEST_PAYMENT_TX>`. The server log lists HSP's live tool schemas; if a call fails, compare them with [PROTOCOL.md section 2](PROTOCOL.md#2-settlement-through-hsp-hashkey-settlement-platform).
6. [ ] **Mainnet deploy.** `CONFIRM_MAINNET=yes npm run deploy:hsk-mainnet -w @nod/contracts` (PowerShell form in [DEPLOY.md section 2](DEPLOY.md#2-contracts-on-hsk-chain)), verify both contracts on https://hsk.blockscout.com, commit `contracts/deployments/hskMainnet.json`, and fill in `<NODRECEIPTS_MAINNET>` and `<NODPOLICY_MAINNET>` in the README and SUBMISSION.
7. [ ] **Recorder key and anchoring on mainnet.** Set `NOD_RECEIPTS_CHAIN=hsk-mainnet`, the mainnet addresses and a recorder key funded with mainnet HSK. Pay once more and check that **Anchored** links an anchor transaction on hsk.blockscout.com, and that reopening the link shows **Already paid**.
8. [ ] **Hosting.** Keep the standalone server running on the allowlisted machine (systemd or Docker) behind HTTPS. Deploy the static app to Vercel with `NOD_API_PROXY` ([DEPLOY.md section 5](DEPLOY.md#5-static-app-on-vercel)), set `NOD_PUBLIC_URL`, and run the checks in [DEPLOY.md section 6](DEPLOY.md#6-checks-after-a-deploy). Fill in `<LIVE_URL>`.
9. [ ] **Video.** Record the 90-second script in [DEMO.md](DEMO.md#90-second-video), upload it, and fill in `<VIDEO_URL>`.
10. [ ] **Submission.** Fill the placeholders in [SUBMISSION.md](SUBMISSION.md), go through its checklist, and submit the BUIDL on DoraHacks to the track **Agent Payments & A2A Settlement (HSP)** before Dec 3, 2026, 13:00 KST.
11. [ ] **Demo Day.** Register for Demo Day in Seoul on Dec 5. Demo selection is announced Dec 4.
