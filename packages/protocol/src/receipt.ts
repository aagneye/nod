/**
 * Settlement check (PROTOCOL §2, "Payment check"): the settlement transaction succeeded and
 * contains an ERC-20 Transfer of the configured token from the payer to `terms.payTo` worth
 * at least the terms' amount.
 */
import { decodeEventLog, isAddress, toEventSelector, type Address, type Hash, type Hex } from 'viem';
import { ERC20_ABI } from './contracts.js';

/** The parts of a log the check reads (a viem Log fits). */
export interface SettlementLog {
  address: string;
  topics: readonly Hex[];
  data: Hex;
}

/** The parts of a transaction receipt the check reads (a viem TransactionReceipt fits). */
export interface SettlementReceipt {
  status: string;
  logs: readonly SettlementLog[];
}

/** Anything with viem's PublicClient.getTransactionReceipt. */
export interface SettlementClient {
  getTransactionReceipt(args: { hash: Hash }): Promise<SettlementReceipt>;
}

export interface CheckSettlementInput {
  /** Public client for the payment network (the chain HSP settled on). */
  client: SettlementClient;
  txHash: Hash;
  /** Token contract from the HSP payment option. */
  token: Address;
  payer: Address;
  payTo: Address;
  /** Smallest acceptable transfer in base units, e.g. usdToRaw(terms.amountUsd, option.decimals). */
  minRaw: bigint;
}

export interface SettlementCheck {
  ok: boolean;
  /** Why the check failed; empty when ok. */
  reasons: string[];
  /** Value of the best matching Transfer (payer to payTo), when there is one. */
  transferredRaw?: bigint;
}

export const TRANSFER_TOPIC = toEventSelector('Transfer(address,address,uint256)');

interface Transfer {
  from: Address;
  to: Address;
  value: bigint;
}

const sameAddress = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

const errorMessage = (error: unknown): string =>
  error instanceof Error ? ((error as { shortMessage?: string }).shortMessage ?? error.message) : String(error);

function tokenTransfers(logs: readonly SettlementLog[], token: Address): Transfer[] {
  const transfers: Transfer[] = [];
  for (const log of logs) {
    if (!sameAddress(log.address, token) || log.topics.length !== 3 || log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) {
      continue;
    }
    try {
      const { args } = decodeEventLog({
        abi: ERC20_ABI,
        eventName: 'Transfer',
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
      });
      transfers.push({ from: args.from, to: args.to, value: args.value });
    } catch {
      // not an ERC-20 Transfer (e.g. malformed data); ignore
    }
  }
  return transfers;
}

/**
 * Check a settlement on its payment network. Throws only on invalid arguments;
 * a receipt that cannot be fetched (e.g. not mined yet) comes back as ok: false with a reason.
 */
export async function checkSettlement(input: CheckSettlementInput): Promise<SettlementCheck> {
  const { client, txHash, token, payer, payTo, minRaw } = input;
  if (typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new Error(`checkSettlement: txHash must be a 32-byte hex hash, got ${String(txHash)}`);
  }
  for (const [name, value] of [['token', token], ['payer', payer], ['payTo', payTo]] as const) {
    if (typeof value !== 'string' || !isAddress(value, { strict: false })) {
      throw new Error(`checkSettlement: ${name} must be an address, got ${String(value)}`);
    }
  }
  if (typeof minRaw !== 'bigint' || minRaw < 0n) {
    throw new Error('checkSettlement: minRaw must be a non-negative bigint');
  }

  let receipt: SettlementReceipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash });
  } catch (error) {
    return { ok: false, reasons: [`Could not get the receipt of ${txHash}: ${errorMessage(error)}`] };
  }
  if (receipt.status !== 'success') {
    return { ok: false, reasons: [`Transaction ${txHash} did not succeed (status: ${receipt.status})`] };
  }

  const transfers = tokenTransfers(receipt.logs, token);
  if (transfers.length === 0) {
    return { ok: false, reasons: [`Transaction ${txHash} has no Transfer of token ${token}`] };
  }
  const matching = transfers.filter((t) => sameAddress(t.from, payer) && sameAddress(t.to, payTo));
  if (matching.length === 0) {
    const seen = transfers.map((t) => `${t.from} -> ${t.to} (${t.value})`).join(', ');
    return { ok: false, reasons: [`No Transfer of ${token} from ${payer} to ${payTo}; found ${seen}`] };
  }
  const best = matching.reduce((a, b) => (b.value > a.value ? b : a));
  if (best.value < minRaw) {
    return {
      ok: false,
      reasons: [`Transfer of ${best.value} is less than the ${minRaw} required`],
      transferredRaw: best.value,
    };
  }
  return { ok: true, reasons: [], transferredRaw: best.value };
}
