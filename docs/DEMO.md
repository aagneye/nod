# Nod demo

Three parts: what the payer needs, the 2-minute path a judge clicks, and the 90-second video script. Button and label names below are the ones in the app (buttons render in capitals).

Placeholders: `<LIVE_URL>`, `<VIDEO_URL>`, `<NODRECEIPTS_MAINNET>`.

## What the payer needs

1. **A browser wallet.** OKX Wallet or MetaMask as a desktop browser extension; any EIP-6963 wallet works. The **Connect a wallet** dialog lists the wallets the browser announces. With none installed it shows **Get OKX Wallet** and **Get MetaMask** links.
2. **The test token HSP pays in.** The home page's **Live status** panel shows it in the **Pays on** and **Token** rows, read live from HSP's `get_chain_config`. For this hackathon the faucet page points to Circle test USDC on Ethereum Sepolia: token `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`, 6 decimals.
   - Get it from Circle's faucet, https://faucet.circle.com: choose USDC and Ethereum Sepolia, then paste the wallet address. One demo payment costs 0.10 USD.
   - If the panel shows another network or token, fund that one instead.
   - To see the balance in the wallet, add the token by its address on Sepolia.
3. **No gas to sign.** The wallet signs an EIP-712 authorization (`eth_signTypedData_v4`); that is not a transaction. HSP's Gateway sends the transfer. The **Token** row also shows the authorization type HSP uses (`eip3009` or `permit2`).
4. **The payment network in the wallet.** Before signing, the app asks the wallet to switch to the chain in HSP's authorization (Sepolia for this test USDC) and to add it if the wallet does not know it. Accept.

## Judge path (about 2 minutes)

Use a desktop browser with the wallet extension and test USDC.

1. **Open `<LIVE_URL>`.** Scroll to **Live status**. **HSP** shows **Live** and **Reachable**. **Pays on** and **Token** show the network and token. **NodReceipts** shows `<NODRECEIPTS_MAINNET>` on HashKey Chain, with **Recorder** and **NodPolicy** below it. Every address links to the explorer.
2. **Press Try the demo.** The demo weather agent signs fresh terms and the approval page opens (`/r#…`).
3. **Read the terms.** The badges say **Signature valid** and **Expires in …**. "Nod weather agent" asks you to pay $0.10 USD for "1 live weather report". The rows show **Pay to**, **For**, **Agent key**, **Expires** and **Terms hash**. The signature was checked in your browser.
4. **Press Nod — approve payment.** Pick your wallet in **Connect a wallet** and approve the connection. The button shows "Asking HSP for a quote…".
5. **Read the HSP quote.** It shows the token amount (0.1 USDC), **Network**, **Token**, **Payer (you)** and **Pay to** with "✓ same address the agent signed". The badge shows how long the quote stays valid (about 5 minutes). **What your wallet will sign** opens HSP's EIP-712 message exactly as HSP built it.
6. **Press Sign in wallet.** Accept the network switch if asked, then sign. The button shows "Check your wallet…", then "Sending to HSP…", and the receipt page opens.
7. **Watch it settle.** The HSP timeline moves through **Submitted**, **Verified**, **Processing**, **Included**, **Safe** and **Finalized**; the page checks every 3 s. The headline turns to **Paid** with the badge **Paid via HSP**. **Settlement transaction** shows the hash and an **Explorer** link.
8. **Check the proof.** Under **Proof**: **Settlement check** says **Transfer verified**, and **Receipt on HSK Chain** says **Anchored**, with an **Anchor tx** link to the `NodReceipts` transaction on https://hsk.blockscout.com.
9. **See the delivery.** **Delivered by the vendor** shows **Vendor verified payment** and a live weather report. The seller agent checked HSP's status and the transfer on chain itself.
10. **Try to pay twice.** Press the browser's Back button. The approval page now shows **Already paid**, "These terms have already been paid." and **View receipt**.

Optional: **How it works** (`/how`) lists the HSP tool sequence and shows the `NodReceipts` and `NodPolicy` source. **Copy receipt link** on the receipt page copies a link that carries the signed terms, so anyone can re-check the payment against them.

No test USDC? Go as far as the quote and press **Cancel**. Nothing is signed or paid until **Sign in wallet**.

If something looks wrong:

- **HSP unavailable** ("Payments are paused for a moment"): the server cannot reach HSP. Nothing was signed or charged. Press **Try again**.
- **Quote expired**: press **Get a new quote**, then sign again.
- A banner "Simulation mode — no real payment" means the server runs mock HSP. The live demo must never show it.

## 90-second video

Record at 1080p in a desktop browser with OKX Wallet. Before recording:

- `GET <LIVE_URL>/api/config` shows `"mode":"live"`, `"reachable":true`, the mainnet `NodReceipts` address and a recorder, and no `error` (`docs/DEPLOY.md` section 6).
- The payer wallet holds test USDC; the recorder holds a little mainnet HSK.
- Claude Code has the Nod MCP server (README) and one request that was already paid, for shot 10.

| # | Time | Shot | On-screen text | Voice-over |
| --- | --- | --- | --- | --- |
| 1 | 0:00–0:06 | Home hero, then scroll to **Live status**: **Live**, **Reachable**, **NodReceipts** on HashKey Chain | Your agent asks. You nod. HSK Chain settles. | "AI agents are starting to pay for things. They should not hold your money." |
| 2 | 0:06–0:14 | Press **Try the demo**. Approval page: **Signature valid**, $0.10 USD, **Pay to**, **Agent key**, **Expires in …** | The agent signs EIP-712 terms. Its key holds no funds. | "A weather agent signs payment terms: who gets paid, how much, for what, and until when." |
| 3 | 0:14–0:24 | Press **Nod — approve payment**. **Connect a wallet** → OKX Wallet → approve. "Asking HSP for a quote…" | You nod in your own wallet. | "Nod checked the signature and the expiry in my browser. I connect my own wallet, and Nod asks HSP for a quote." |
| 4 | 0:24–0:34 | **HSP quote**: 0.1 USDC, **Network**, **Token**, **Pay to** "✓ same address the agent signed". Open **What your wallet will sign** | HSP quotes the exact token amount. | "HSP returns the exact token amount and an authorization to sign. Nod checks it pays the address the agent signed." |
| 5 | 0:34–0:42 | Press **Sign in wallet**. The wallet shows the typed data; approve. "Sending to HSP…" | One signature. No gas. | "One signature. It is not a transaction: HSP's Gateway executes the transfer." |
| 6 | 0:42–0:54 | Receipt page: timeline **Submitted** → **Safe**, headline **Paid**, badge **Paid via HSP**, **Settlement transaction** → **Explorer** | Settled through HSP. | "Nod shows every HSP status until the payment is safe." |
| 7 | 0:54–1:06 | **Proof**: **Transfer verified**, **Anchored**. Click **Anchor tx**: the `NodReceipts` transaction on hsk.blockscout.com | Receipt anchored on HSK Chain mainnet. | "The server checks the token transfer on chain, then anchors terms hash to settlement in NodReceipts on HSK Chain mainnet." |
| 8 | 1:06–1:12 | **Delivered by the vendor**: **Vendor verified payment** and the weather report | The seller agent checks, then delivers. | "The weather agent verifies the payment itself and delivers." |
| 9 | 1:12–1:18 | Browser Back: **Already paid**, **View receipt** | No double payments. | "Open the same link again: already paid." |
| 10 | 1:18–1:25 | Claude Code (recorded beforehand): `nod_request_payment` returns a link; later `nod_payment_status` returns PAID with the settlement transaction | Any agent can ask: MCP server or CLI. | "Any agent can ask this way. Claude uses Nod's MCP server, and checks the receipt once you have paid." |
| 11 | 1:25–1:30 | **How it works**, the NodPolicy section, then an end card: Nod, `<LIVE_URL>`, github.com/aagneye/nod | NodPolicy: capped agent payments without a nod. | "And NodPolicy lets an agent pay within a cap you set. Your agent asks. You nod. HSK Chain settles." |

Upload the video and put its link in `<VIDEO_URL>` (README and `docs/SUBMISSION.md`).
