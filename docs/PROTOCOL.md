# Nod protocol v2: agent payments on HSK Chain with HSP

Nod splits an agent payment into three steps: the **agent asks** (signed payment terms), a **person nods** (a wallet signature over an HSP payment authorization), and **HSK Chain settles** (HSP's Gateway executes the transfer, and Nod anchors the receipt on HSK Chain).

## 1. Terms: what a receiving agent asks for

```ts
interface NodTerms {
  v: 2;
  id: `0x${string}`;        // bytes16: 0x + 32 hex chars, random per request
  merchant: string;         // 1-64 chars, shown to the payer
  payTo: `0x${string}`;     // recipient address (checksummed)
  amountUsd: string;        // decimal string > 0, at most 2 decimals, at most "10000.00"
  purpose: string;          // 1-140 chars
  expiry: number;           // unix seconds
  agent: `0x${string}`;     // address of the agent key that signs the terms (checksummed)
}
interface SignedTerms { terms: NodTerms; sig: `0x${string}` } // 65-byte EIP-712 signature
```

Signing uses EIP-712. Terms are network-independent, so the domain has no `chainId`:

```ts
domain = { name: 'Nod', version: '2' }
types  = { Terms: [
  { name: 'v', type: 'uint8' },         { name: 'id', type: 'bytes16' },
  { name: 'merchant', type: 'string' }, { name: 'payTo', type: 'address' },
  { name: 'amountUsd', type: 'string' },{ name: 'purpose', type: 'string' },
  { name: 'expiry', type: 'uint64' },   { name: 'agent', type: 'address' } ] }
termsHash = hashTypedData({ domain, types, primaryType: 'Terms', message: terms })  // bytes32
```

Signed terms are valid when the address recovered from `sig` equals `terms.agent`, every field passes validation, and `expiry` is in the future.

**Link:** `<app>/r#<payload>`, where `payload = base64url(JSON.stringify(signedTerms))` without padding. `expiry` is a JSON number; addresses are checksummed.

## 2. Settlement through HSP (HashKey Settlement Platform)

Nod's server is an MCP client of HSP Agentic Payment (Streamable HTTP, default `https://mcp-qa.hashkeymerchant.com/`). HSP only accepts calls from allowlisted public IPs. Tool order:

1. `get_chain_config` (cached): pick the network and token. Use the returned `network`, `chain_id`, token `address`, `coin`, `decimals` and `payment_protocol` (`eip3009` or `permit2`); never hard-code them. Preference: `NOD_PAY_NETWORK` if set, else HSK Chain testnet USDC if offered, else the first USDC entry.
2. `create_order` with `merchant_name` = the team's HSP reporting name (`NOD_MERCHANT_NAME`), `pay_to` = `terms.payTo`, and this cart mandate:

```json
{ "contents": {
    "id": "nod-<first 16 hex of termsHash>-<8 random hex>",
    "user_cart_confirmation_required": true,
    "cart_expiry": "<RFC 3339, min(terms.expiry, now + 2h)>",
    "merchant_name": "<NOD_MERCHANT_NAME>",
    "payment_request": {
      "method_data": [{ "supported_methods": "https://www.x402.org/",
        "data": { "x402Version": 2, "network": "<cfg>", "chain_id": 0, "contract_address": "<cfg>", "pay_to": "<terms.payTo>", "coin": "<cfg>" } }],
      "details": {
        "id": "nodpr-<first 16 hex of termsHash>-<8 random hex>",
        "display_items": [{ "label": "<merchant>: <purpose>", "amount": { "currency": "USD", "value": "<amountUsd>" } }],
        "total": { "label": "Total", "amount": { "currency": "USD", "value": "<amountUsd>" } } } } } }
```

3. `prepare_payment(flow_id, payer, protocol)` returns `eip712`, `token_total_raw`, `quote_expires_at` (5 minutes), `payment_payload`, `payment_mandate_contents` and `cart_hash`.
4. The payer's wallet signs `eip712` unchanged (`eth_signTypedData_v4`, with the wallet switched to `eip712.domain.chainId`).
5. `finalize_payment(signature, payment_payload, payment_mandate_contents, cart_hash)` returns `payment_mandate_json`, which goes unchanged to `submit_payment`.
6. `query_payment(flow_id or payment_request_id, expected_merchant_name)` every few seconds. Keep polling on `payment-submitted`, `payment-verified`, `payment-processing`, `payment-included` and `payment-timeout`. Stop on `payment-safe` or `payment-finalized` (paid) and `payment-failed` (show `status_reason`). The transaction hash is `payment.tx_signature`. An expired quote (or Gateway code 30043) needs a new `prepare_payment` and a new signature.

Nod never builds x402 JSON, JWTs or payment hashes itself; HSP's tools do. Input shapes follow the live tool schemas; the parameter names above are the documented ones.

**Payment check:** a settlement pays the terms when HSP reports `payment-safe` or `payment-finalized`, and the transaction receipt on the payment network contains an ERC-20 `Transfer` of the configured token from the payer to `terms.payTo` with `value >= parseUnits(amountUsd, decimals)`.

## 3. Receipt anchor on HSK Chain: `NodReceipts`

HSP's EIP-3009 transfer cannot carry Nod data, so Nod records the link between terms and settlement on HSK Chain:

```solidity
struct Receipt { bytes32 settlementTx; uint256 chainId; address payer; address payTo; uint256 amount; uint64 anchoredAt; }
event Anchored(address indexed recorder, bytes32 indexed termsHash, bytes32 settlementTx, uint256 chainId, address payer, address payTo, uint256 amount);
error AlreadyAnchored(address recorder, bytes32 termsHash);
error LengthMismatch();
function anchor(bytes32 termsHash, bytes32 settlementTx, uint256 chainId, address payer, address payTo, uint256 amount) external;
function anchorBatch(bytes32[] calldata termsHashes, bytes32[] calldata settlementTxs, uint256[] calldata chainIds, address[] calldata payers, address[] calldata payTos, uint256[] calldata amounts) external;
function receiptOf(address recorder, bytes32 termsHash) external view returns (Receipt memory);
function isAnchored(address recorder, bytes32 termsHash) external view returns (bool);
```

Receipts are namespaced by recorder (`msg.sender`), so nobody can block or overwrite another recorder's receipt. Verifiers trust a known recorder, such as the vendor or the Nod server. A request counts as paid once its recorder has anchored it.

## 4. Autonomous payments within limits: `NodPolicy`

For small agent-to-agent payments without a nod each time. Funds stay in the owner's wallet: the owner approves `NodPolicy` for an ERC-20 token and sets limits per agent.

```solidity
struct Policy { uint128 cap; uint64 period; uint64 periodStart; uint128 spent; bool active; }
event PolicySet(address indexed owner, address indexed agent, address indexed token, uint128 cap, uint64 period);
event PayeeAllowed(address indexed owner, address indexed agent, address indexed payee, bool allowed);
event PolicyRevoked(address indexed owner, address indexed agent, address indexed token);
event PolicyPaid(address indexed owner, address indexed agent, address indexed payee, address token, uint256 amount, bytes32 termsHash);
function setPolicy(address agent, address token, uint128 cap, uint64 period) external;           // msg.sender = owner
function allowPayee(address agent, address payee, bool allowed) external;                        // msg.sender = owner
function revoke(address agent, address token) external;                                           // msg.sender = owner
function pay(address owner, address token, address payee, uint256 amount, bytes32 termsHash) external; // msg.sender = agent
function policyOf(address owner, address agent, address token) external view returns (Policy memory);
function isPayeeAllowed(address owner, address agent, address payee) external view returns (bool);
```

Errors: `ZeroAddress()`, `InvalidLimits()`, `ZeroAmount()`, `PolicyInactive(address owner, address agent, address token)`, `PayeeNotAllowed(address owner, address agent, address payee)`, `CapExceeded(uint256 available, uint256 amount)`, plus OpenZeppelin's `ReentrancyGuardReentrantCall()` and `SafeERC20FailedOperation(address token)`. `policyOf` reports the current period (after a period ends it shows `spent = 0` and the rolled-forward `periodStart`); `revoke` deletes the policy; `setPolicy` rejects a zero agent, token, cap or period.

`pay` requires an active policy, an allowed payee, and `spent + amount <= cap` within the current period. A new period starts once `block.timestamp >= periodStart + period`. Tokens move with `SafeERC20.safeTransferFrom(owner, payee, amount)`. Revoking the policy, or the token approval, stops the agent immediately.

## 5. Networks

| Network | Chain ID | RPC | Explorer |
| --- | --- | --- | --- |
| HSK Chain mainnet | 177 | https://mainnet.hsk.xyz | https://hsk.blockscout.com |
| HSK Chain testnet | 133 | https://testnet.hsk.xyz | https://testnet-explorer.hskchain.net |
| Ethereum Sepolia (HSP test USDC) | 11155111 | public RPC | https://sepolia.etherscan.io |

HSK Chain mainnet tokens: USDC (bridged) `0x054ed45810DbBAb8B27668922D110669c9D88D0a`, USDT `0xf1b50ed67a9e2cc94ad3c477779e2d4cbfff9029`. Circle test USDC on Sepolia: `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`. HSK testnet faucet: https://faucet.hsk.xyz/faucet. HSP payment tokens always come from `get_chain_config`.
