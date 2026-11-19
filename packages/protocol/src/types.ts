/**
 * Shared types for the Nod protocol.
 * Every module in this package (request, electrum, tx, receipt) codes against these.
 */

export type Network = 'mainnet' | 'chipnet';

/** Amount in satoshis of BCH. */
export interface SatsAmount {
  sats: number;
}

/** Amount of a fungible CashToken, in the token's smallest units. */
export interface TokenAmount {
  /** Token category id as 64-char hex (as shown in explorers, i.e. big-endian). */
  token: string;
  /** Smallest units as a decimal string (bigint-safe). */
  units: string;
}

export type Amount = SatsAmount | TokenAmount;

/** Nod Request v1: what an agent asks a person to pay for. */
export interface NodRequest {
  v: 1;
  /** 16 random bytes as 32-char lowercase hex. */
  id: string;
  /** Agent's compressed secp256k1 public key, 66-char hex. */
  agent: string;
  /** Human-readable agent label. */
  agentName: string;
  /** Vendor cashaddr (bitcoincash:... or bchtest:...). Token payments need a token-aware address. */
  vendor: string;
  amount: Amount;
  /** Short reason for the purchase, max 140 chars. */
  purpose: string;
  /** Unix seconds after which the request must not be paid. */
  expiry: number;
  /** Optional cashaddr of the person expected to pay. */
  buyer?: string;
}

/** A request plus the agent's Schnorr signature over its hash. */
export interface SignedNodRequest {
  req: NodRequest;
  /** 64-byte Schnorr signature as 128-char hex. */
  sig: string;
}

/** An unspent output the buyer's wallet controls. */
export interface Utxo {
  txid: string;
  vout: number;
  satoshis: bigint;
  /** Locking bytecode of the output, hex. */
  lockingBytecode: string;
  token?: {
    category: string;
    amount: bigint;
    nft?: { capability: 'none' | 'mutable' | 'minting'; commitment: string };
  };
}

/**
 * WizardConnect needs to know which HD path signs each input.
 * [inputIndex, pathName, addressIndex]
 */
export type InputPath = [number, 'receive' | 'change' | 'defi', number];

/** A coin the buyer can spend, with the HD path WizardConnect uses to sign it. */
export interface SpendableUtxo extends Utxo {
  path: ['receive' | 'change' | 'defi', number];
}

export interface ReceiptCheck {
  ok: boolean;
  reasons: string[];
}
