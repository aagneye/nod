import { hashTransaction, hexToBin } from '@bitauth/libauth';
import {
  buildPayment,
  hashRequest,
  type BuiltPayment,
  type SignedNodRequest,
  type SpendableUtxo,
} from '@nod/protocol';
import type { DappConnectionManager } from '@wizardconnect/dapp';
import { sourceOutputToRelay } from '@wizardconnect/core/hdwalletv1-serialize';
import { addressFromPubkey } from '../lib/address';
import { getChain } from '../lib/chain';
import { NETWORK } from '../config';

/** How many HD indices we scan per path when collecting UTXOs. */
const SCAN = [
  { child: 0, name: 'receive', count: 20 },
  { child: 1, name: 'change', count: 10 },
] as const;

/** The wallet's primary receive address and its change address. */
export function walletAddresses(manager: DappConnectionManager): { receive: string; change: string } {
  const receiveKey = manager.getPubkey(0, 0n);
  if (!receiveKey) throw new Error('Wallet is not ready yet — wait for the connection to finish.');
  // Change returns to the receive address: single-address wallets may not watch
  // the HD change path, and a judge must see their change land where they expect.
  const receive = addressFromPubkey(receiveKey);
  return { receive, change: receive };
}

/**
 * Every UTXO the connected wallet controls (receive + change paths), each
 * tagged with the HD path WizardConnect needs to sign it. Batched queries so
 * the judge does not wait long.
 */
export async function collectUtxos(manager: DappConnectionManager): Promise<SpendableUtxo[]> {
  const chain = await getChain();
  const jobs: { path: SpendableUtxo['path']; address: string }[] = [];
  for (const { child, name, count } of SCAN) {
    for (let i = 0; i < count; i++) {
      const pubkey = manager.getPubkey(child, BigInt(i));
      if (!pubkey) break;
      jobs.push({ path: [name, i], address: addressFromPubkey(pubkey) });
    }
  }

  const found: SpendableUtxo[] = [];
  let failures = 0;
  let lastError: unknown;
  const BATCH = 8;
  for (let i = 0; i < jobs.length; i += BATCH) {
    const batch = jobs.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (job) => ({
        job,
        utxos: await chain.getUtxos(job.address).catch((e: unknown) => {
          failures++;
          lastError = e;
          return [];
        }),
      })),
    );
    for (const { job, utxos } of results) {
      for (const utxo of utxos) found.push({ ...utxo, path: job.path });
    }
  }
  // An empty result because the server dropped is not "no funds": say so.
  if (found.length === 0 && failures > 0) {
    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`Could not read your balance from the BCH server (${reason}). Please try again.`);
  }
  return found;
}

export interface SignResult {
  txid: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Hand the unsigned transaction to the wallet over WizardConnect. The wallet
 * signs with the HD paths in `inputPaths` and broadcasts (broadcast: true).
 * If the tx has not appeared on our Electrum server within a few seconds we
 * broadcast the signed hex ourselves — same bytes, so a double broadcast is
 * harmless (the server answers "already known").
 */
export async function signAndBroadcast(
  manager: DappConnectionManager,
  built: BuiltPayment,
  userPrompt: string,
): Promise<SignResult> {
  const chain = await getChain();
  const response = await manager.signTransaction({
    transaction: {
      transaction: built.txHex,
      // The relay JSON-encodes the message: bytes must become hex and bigints a tagged string.
      sourceOutputs: built.sourceOutputs.map((so) => sourceOutputToRelay(so)),
      userPrompt,
      // Ask for the signature only. Some wallets answer "Network Error" while
      // broadcasting even though they signed fine, so the app publishes the
      // signed bytes itself over the Electrum servers it already trusts.
      broadcast: false,
    },
    inputPaths: [...built.inputPaths],
  });
  if (response.error) throw new Error(response.error);
  const signedHex = response.signedTransaction;
  if (!signedHex) throw new Error('The wallet returned no signed transaction.');
  const txid = hashTransaction(hexToBin(signedHex));

  try {
    const broadcastTxid = await chain.broadcast(signedHex);
    if (broadcastTxid !== txid) throw new Error('Broadcast returned an unexpected txid.');
  } catch (e) {
    // A wallet that ignores broadcast:false may have sent it already; only fail
    // once the chain still does not know the transaction.
    let onChain = false;
    for (let attempt = 0; attempt < 8 && !onChain; attempt++) {
      try {
        await chain.getTransactionHex(txid);
        onChain = true;
      } catch {
        await sleep(1000);
      }
    }
    if (!onChain) throw e;
  }
  return { txid };
}

/** Convenience: build the single-payment transaction for one request. */
export function buildForRequest(
  manager: DappConnectionManager,
  signed: SignedNodRequest,
  utxos: SpendableUtxo[],
): BuiltPayment {
  const { change } = walletAddresses(manager);
  return buildPayment({
    network: NETWORK,
    payments: [
      {
        vendor: signed.req.vendor,
        amount: signed.req.amount,
        requestHash: hashRequest(signed.req),
      },
    ],
    utxos,
    changeAddress: change,
  });
}
