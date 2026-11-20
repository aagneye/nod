# Nod Request v1

A Nod Request is a small signed message in which an AI agent asks a person to pay a vendor in Bitcoin Cash (BCH or a fungible CashToken). The person approves it in their wallet. The payment transaction commits the request's hash in an `OP_RETURN` memo, so anyone can check on-chain that the request was paid, without a server or contract state.

Reference implementation: `packages/protocol/src/request.ts` (request format, hashing, signing, links), `memo.ts` (memo encoding), `receipt.ts` (payment matching).

## 1. Fields

A request is a JSON object. Unknown fields are rejected.

| Field | Type | Required | Rules |
|---|---|---|---|
| `v` | number | yes | Must be `1`. |
| `id` | string | yes | 16 random bytes as 32 lowercase hex chars. Makes each request unique. |
| `agent` | string | yes | Agent's compressed secp256k1 public key: 66 lowercase hex chars starting `02` or `03`. |
| `agentName` | string | yes | Human-readable label, 1 to 64 chars. Not authenticated beyond the signature: wallets must show `agent` (or a fingerprint) too. |
| `vendor` | string | yes | Lowercase cashaddr with prefix `bitcoincash:` (mainnet) or `bchtest:` (chipnet), valid checksum. Token payments should use a token-aware address (`z...`/`r...`). |
| `amount` | object | yes | Exactly one of the two forms below. |
| `amount.sats` | number | | BCH amount in satoshis: integer, at least 546 (dust limit), at most 2^53 - 1. |
| `amount.token` + `amount.units` | string + string | | `token`: category id, 64 lowercase hex chars, in the byte order explorers display. `units`: smallest token units as a decimal string, no sign, no leading zeros, 1 to 2^63 - 1. |
| `purpose` | string | yes | Why the agent wants to pay, 1 to 140 chars (`MAX_PURPOSE_LENGTH`, counted in UTF-16 code units). |
| `expiry` | number | yes | Unix time in seconds, positive integer. The request must not be paid after this time. |
| `buyer` | string | no | Cashaddr of the person expected to pay, same rules as `vendor`. Leave it out (do not send `null`) when unknown. |

A signed request wraps the request with the agent's signature:

```json
{ "req": { ...request... }, "sig": "<64-byte Schnorr signature, 128 lowercase hex chars>" }
```

## 2. Canonical form

The canonical form is the UTF-8 JSON encoding of the request with:

- object keys sorted ascending (by UTF-16 code unit, as JavaScript's default sort does) at every level, including inside `amount`;
- no whitespace between tokens;
- fields whose value is `undefined` left out (so a request without `buyer` has no `buyer` key);
- strings escaped as `JSON.stringify` does; numbers written as plain integers.

Strings are hashed as given: no Unicode normalization. Since every field is validated before hashing, all values are strings, integers, or the `amount` object.

## 3. Hashing

```
requestHash = sha256(utf8(canonical(req)))          // 32 bytes
batchHash   = sha256(sort(h1, h2, ..., hn) concatenated)
```

For a batch, the request hashes are sorted ascending bytewise (lexicographic on the raw 32-byte values) and concatenated before hashing, so the order of the requests does not matter. A batch holds 1 to 50 (`MAX_BATCH`) distinct hashes; the reference implementation rejects empty, oversized and duplicate batches. In practice a single request uses the single memo kind, not a batch of one.

## 4. Signature

- Scheme: BCH Schnorr over secp256k1 (the scheme BCH uses for transaction signatures since 2019; libauth `secp256k1.signMessageHashSchnorr` / `verifySignatureSchnorr`).
- Message: the 32-byte `requestHash` (signed directly, not hashed again).
- Key: the private key for `agent`.
- Encoding: 64 bytes as 128 lowercase hex chars in `sig`.

A signed request is valid when it passes the schema in section 1 and `sig` verifies against `agent` and `requestHash`. Changing any field (amount, vendor, purpose, buyer, ...) changes the hash and breaks the signature. The signature proves which agent key made the request; deciding whether to trust that key is up to the wallet or user.

## 5. Link format

```
payload = base64url( utf8( JSON.stringify({ req, sig }) ) )   // RFC 4648 section 5 alphabet, no "=" padding
url     = <baseUrl>/r#<payload>
```

The payload sits in the URL fragment, so it is never sent to the web server. The JSON inside the link does not need to be canonical: the receiver parses it, validates it, and re-canonicalizes before hashing.

Decoding (`decodeLink`): a payload that is not base64url, not UTF-8 JSON, or not a schema-valid `{req, sig}` is rejected with an error. Otherwise it returns the signed request with two flags: `valid` (signature check) and `expired` (`now > expiry`). Wallets must refuse to pay when `valid` is false or `expired` is true.

## 6. On-chain memo

The paying transaction includes exactly one output with zero value and this locking bytecode:

```
OP_RETURN <"NOD"> <kind> <hash>

6a 03 4e4f44 01 <kind> 20 <32-byte hash>        // 40 bytes
```

| Kind | Byte | Hash |
|---|---|---|
| single | `0x01` | `requestHash` of the one request paid |
| batch | `0x02` | `batchHash` of every request paid in the transaction |

The kind is written as a 1-byte data push (`01 01` or `01 02`). Parsers should also accept the minimal-push form `OP_1` (`0x51`) / `OP_2` (`0x52`). The hash bytes are written in the order `sha256` produces them (no reversal). The whole memo is well under the 223-byte `OP_RETURN` limit even for a 50-request batch.

## 7. Matching a payment to a request

A transaction pays request `R` (hash `H`) when both hold:

1. **Vendor output.** Some output's locking bytecode equals the locking bytecode of `R.vendor`, and
   - for `{sats}`: the output carries no token and its value equals `sats` exactly;
   - for `{token, units}`: the output carries a fungible token (no NFT) of category `token` with amount equal to `units` exactly.
2. **Memo.** The transaction has a Nod memo that commits `H`:
   - single memo: memo hash equals `H`;
   - batch memo: the checker knows the full list of request hashes in the batch, `H` is in that list, and the memo hash equals `hashBatch(list)`. Each request in the batch has its own vendor output: when the checker also knows the batch requests, k requests with the same vendor and amount need k matching outputs (`batchRequests` in the reference `verifyReceipt`).

Both conditions must hold in the same transaction. Overpaying or underpaying does not match.

**Paid check.** To find whether `R` has been paid, scan the vendor address history (newest first) for a transaction that matches as above. No contract or server state is needed.

## 8. Expiry and replay

- A request must not be paid once `now > expiry` (now in Unix seconds). A payment confirmed after expiry is still visible on-chain; vendors decide whether to honour it, and should use block time rather than the time they saw it.
- **Pay once.** Before paying, the wallet runs the paid check. If a matching transaction exists, it must not pay again. The random `id` means two otherwise identical requests have different hashes, so a vendor can tell a repeat purchase from a replayed link.
- **Vendor side.** A vendor delivers once per request hash: it records `requestHash` (or the txid) when it delivers and refuses to deliver again for the same hash.
- **Cross-network.** The cashaddr prefix in `vendor` binds a request to mainnet or chipnet; a chipnet request cannot be matched by a mainnet payment.
- Agents should keep expiries short (minutes to hours) so a leaked link has a short useful life.

## 9. Worked example

These values come from the reference implementation (libauth Schnorr signing is deterministic, so they reproduce exactly).

Inputs:

- Agent private key: `0101010101010101010101010101010101010101010101010101010101010101`
- Agent public key: `031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f`
- Vendor: P2PKH of the public key for private key `02...02` (hash160 `ebc0ee0b2ab9e8277a600c251475e22a3241a1c1`) on chipnet: `bchtest:qr4upmst92u7sfm6vqxz29r4ug4rysdpcytc853pps`
- `id`: `6e6f642d6578616d706c652d30303031` (fixed for the example; normally random)

Request:

```json
{
  "v": 1,
  "id": "6e6f642d6578616d706c652d30303031",
  "agent": "031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f",
  "agentName": "research-bot",
  "vendor": "bchtest:qr4upmst92u7sfm6vqxz29r4ug4rysdpcytc853pps",
  "amount": { "sats": 2500 },
  "purpose": "1 call to weather API",
  "expiry": 1795400000
}
```

Canonical form:

```
{"agent":"031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f","agentName":"research-bot","amount":{"sats":2500},"expiry":1795400000,"id":"6e6f642d6578616d706c652d30303031","purpose":"1 call to weather API","v":1,"vendor":"bchtest:qr4upmst92u7sfm6vqxz29r4ug4rysdpcytc853pps"}
```

Hash and signature:

```
requestHash = 3a977c6df95f2c090d1f689379e6c6ae49c358df0619778d4c5a20f0bf932222
sig         = 664f306f1bba6e4e30580b5a2d1b7d55bbc485b40a0ce38aed4249891a7cb323251a44c959a27fb67fb125c7800b204ddeef68aa1cf4a25a5d862567597941e7
```

Link (base URL `https://nod.example`):

```
https://nod.example/r#eyJyZXEiOnsidiI6MSwiaWQiOiI2ZTZmNjQyZDY1Nzg2MTZkNzA2YzY1MmQzMDMwMzAzMSIsImFnZW50IjoiMDMxYjg0YzU1NjdiMTI2NDQwOTk1ZDNlZDVhYWJhMDU2NWQ3MWUxODM0NjA0ODE5ZmY5YzE3ZjVlOWQ1ZGQwNzhmIiwiYWdlbnROYW1lIjoicmVzZWFyY2gtYm90IiwidmVuZG9yIjoiYmNodGVzdDpxcjR1cG1zdDkydTdzZm02dnF4ejI5cjR1ZzRyeXNkcGN5dGM4NTNwcHMiLCJhbW91bnQiOnsic2F0cyI6MjUwMH0sInB1cnBvc2UiOiIxIGNhbGwgdG8gd2VhdGhlciBBUEkiLCJleHBpcnkiOjE3OTU0MDAwMDB9LCJzaWciOiI2NjRmMzA2ZjFiYmE2ZTRlMzA1ODBiNWEyZDFiN2Q1NWJiYzQ4NWI0MGEwY2UzOGFlZDQyNDk4OTFhN2NiMzIzMjUxYTQ0Yzk1OWEyN2ZiNjdmYjEyNWM3ODAwYjIwNGRkZWVmNjhhYTFjZjRhMjVhNWQ4NjI1Njc1OTc5NDFlNyJ9
```

Paying it alone. The transaction has two outputs that matter:

```
output: 2500 sats to bchtest:qr4upmst92u7sfm6vqxz29r4ug4rysdpcytc853pps
        (locking bytecode 76a914ebc0ee0b2ab9e8277a600c251475e22a3241a1c188ac)
output: 0 sats, locking bytecode
        6a034e4f440101203a977c6df95f2c090d1f689379e6c6ae49c358df0619778d4c5a20f0bf932222
```

Paying it in a batch. A second request from the same agent, with `id` `6e6f642d6578616d706c652d30303032`, `amount` `{"sats":1000}` and `purpose` `"1 call to maps API"` (other fields the same), has hash `885d225b90c50a314821e27ad0986a986727333b3c8988e99de8eb66cdee2cfb`. One transaction pays both:

```
output: 2500 sats to the vendor
output: 1000 sats to the vendor
output: 0 sats, 6a034e4f44010220ca4e657d388ae06a51a6f843f1c632d1f95728ecfe29bf479629e46638860437

batchHash = sha256(3a977c6d...932222 || 885d225b...ee2cfb)
          = ca4e657d388ae06a51a6f843f1c632d1f95728ecfe29bf479629e46638860437
```

(`3a...` sorts before `88...`, so it comes first.) To confirm the first request was paid, a checker needs both request hashes: it finds a 2500-sat vendor output, checks that `3a977c6d...` is in the list, and checks that `hashBatch` of the list equals the memo hash.
