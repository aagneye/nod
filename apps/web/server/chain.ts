/**
 * On-chain access for the API: a public client per chain (settlement checks, receipt reads)
 * and sending NodReceipts.anchor from the recorder key. Behind the ChainAccess interface so
 * tests can substitute fakes.
 */
import { NOD_RECEIPTS_ABI, findChain, type AnchorArgs, type ContractReader, type SettlementClient } from '@nod/protocol';
import { createPublicClient, createWalletClient, http, type Address, type Hash, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

/** What the routes read from a chain (a viem PublicClient fits). */
export interface ChainReader extends SettlementClient, ContractReader {
  waitForTransactionReceipt(args: { hash: Hash; timeout?: number }): Promise<{ status: string }>;
}

export interface AnchorRequest {
  chainId: number;
  /** NodReceipts address. */
  contract: Address;
  /** Recorder key (pays gas; becomes the receipt's recorder). */
  privateKey: Hex;
  args: AnchorArgs;
}

export interface ChainAccess {
  /** Public client for a chain; throws for chains without an RPC URL. */
  reader(chainId: number): ChainReader;
  /** Send NodReceipts.anchor; resolves with the transaction hash once broadcast. */
  anchor(request: AnchorRequest): Promise<Hash>;
}

const RPC_TIMEOUT_MS = 10_000;

/** viem-backed ChainAccess using `rpc` (chain id → URL). Clients are reused per chain. */
export function createViemChains(rpc: Record<number, string>): ChainAccess {
  const readers = new Map<number, ChainReader>();

  const chainAndUrl = (chainId: number) => {
    const chain = findChain(chainId);
    const url = rpc[chainId];
    if (!chain || !url) throw new Error(`No RPC configured for chain ${chainId}`);
    return { chain, url };
  };

  return {
    reader(chainId) {
      let reader = readers.get(chainId);
      if (!reader) {
        const { chain, url } = chainAndUrl(chainId);
        reader = createPublicClient({ chain, transport: http(url, { timeout: RPC_TIMEOUT_MS, retryCount: 1 }) }) as unknown as ChainReader;
        readers.set(chainId, reader);
      }
      return reader;
    },

    async anchor({ chainId, contract, privateKey, args }) {
      const { chain, url } = chainAndUrl(chainId);
      const account = privateKeyToAccount(privateKey);
      const wallet = createWalletClient({ account, chain, transport: http(url, { timeout: RPC_TIMEOUT_MS, retryCount: 1 }) });
      // writeContract estimates gas first, so a revert such as AlreadyAnchored surfaces here,
      // decoded through the ABI, before anything is sent.
      return wallet.writeContract({
        address: contract,
        abi: NOD_RECEIPTS_ABI,
        functionName: 'anchor',
        args: [args.termsHash, args.settlementTx, BigInt(args.chainId), args.payer, args.payTo, args.amount],
        account,
        chain,
      });
    },
  };
}
