# Nod demo

Two scripts: the 75-second video, and the exact path a judge clicks in about 2 minutes.

Placeholders: `<LIVE_URL>`, `<VIDEO_URL>`, `<SLIDES_URL>`, `<MAINNET_TXID>`.

## 75-second video

Record at 1080p. Screen on the left, phone (Paytaca or Cashonize) mirrored or filmed on the right. Keep the cursor slow. Captions are burned in; the voice-over is optional.

| # | Time | Shot | On-screen caption | Voice-over |
|---|---|---|---|---|
| 1 | 0:00–0:06 | Black, then the Nod wordmark | **Your agent asks. You nod. BCH settles.** | "AI agents are starting to buy things. Who holds the money?" |
| 2 | 0:06–0:14 | Split: a terminal with an agent `.env` holding a private key, crossed out; a chat saying "send 0.0001 BCH to q…" | Agents with keys get drained. Manual payments prove nothing. | "Give an agent a wallet and one prompt injection can spend it. Pay by hand and nothing links the payment to the request." |
| 3 | 0:14–0:24 | Claude Desktop: user types "Buy me one weather report from the demo vendor". Claude calls `nod_request_payment` and replies with a link. | The agent signs a request. It holds no money. | "Nod is not another agent. It's the approval layer any agent can use. Claude signs a request: vendor, amount, purpose, expiry." |
| 4 | 0:24–0:34 | Click the link. Approval page: agent name, vendor, 2,000 sats, purpose, expiry, **signature valid**, CHIPNET/MAINNET badge. | You see exactly what you're paying for. | "The link opens an approval page. Signature checked, expiry checked, not already paid." |
| 5 | 0:34–0:46 | Press **Nod**. WizardConnect QR, phone scans it, the wallet shows the transaction, thumb taps Approve. | One tap in your own wallet (WizardConnect). | "I approve with one tap in my own wallet. My keys never leave my phone." |
| 6 | 0:46–0:56 | Receipt page: txid, "request matches payment", the delivered weather report. | Paid on Bitcoin Cash. Item delivered. | "The payment settles on BCH, straight to the vendor, and the vendor releases the item." |
| 7 | 0:56–1:04 | Explorer page for `<MAINNET_TXID>`, zoom on the OP_RETURN output `NOD 01 <hash>`. | The on-chain memo commits to the exact signed request. | "Every payment carries a NOD memo with the hash of the request. That's the receipt, on chain, no database." |
| 8 | 1:04–1:10 | Batch page: three requests, one Nod, one transaction. Then Claude calls `nod_payment_status` → PAID. | Batch approvals. The agent checks the chain itself. | "Approve many requests at once. The agent checks the chain itself." |
| 9 | 1:10–1:15 | End card: live URL, repo, "MCP + CLI for any agent", EMBER2026 address. | **Nod** · `<LIVE_URL>` · github.com/aagneye/nod | "Your agent asks. You nod. BCH settles." |

Recording checklist:
- Fund the phone wallet first. Use a fresh demo request so the "already paid" scan is fast.
- Record shots 3 and 8 against the deployed URL (`NOD_BASE_URL=<LIVE_URL>` in the MCP config).
- Record the explorer shot from a real mainnet payment and keep the txid for the submission.
- Export under 100 MB, upload unlisted to YouTube, and put the link in README, the slides and DoraHacks.

## Judge path (about 2 minutes)

The judge needs a phone wallet with WizardConnect (Paytaca or Cashonize) and a few cents of BCH. The demo payment is 2,000 sats (about $0.01).

1. Open `<LIVE_URL>` on a laptop. The banner at the top shows the **Slides ↗**, **Repo ↗** and **EMBER2026** links.
2. Click **Try the demo**. The demo agent signs a fresh request for "1 live weather report" and the approval page opens.
3. Check the card: agent name and key, vendor address, amount in sats, purpose, expiry countdown, **signature valid**, and the network badge.
4. Click **Connect wallet** (top right) and scan the QR with Paytaca or Cashonize. On a phone, tap **Open in wallet**, or copy the link and paste it into the wallet. Once connected, click **Nod — approve payment**.
5. In the wallet, check that the outputs are the vendor plus an OP_RETURN, then approve.
6. The receipt page opens at `/tx/<txid>`: "request matches payment", an explorer link, and the item delivered by the vendor (the weather report).
7. Optional, 20 seconds: open the receipt URL in a private window. It verifies again from the chain alone.
8. Optional: **Pay a batch** on the home page shows several agent requests paid in one transaction.

If something fails:
- The wallet says insufficient funds: the page explains it. 2,000 sats plus about 300 sats of fee is enough.
- No WizardConnect wallet: the slides and the video show the same flow.
