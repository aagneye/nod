/**
 * Thin Electrum Cash client over secure WebSocket (public Fulcrum servers).
 * Works in browsers and Node 20+ (uses the global WebSocket via @electrum-cash/web-socket).
 */
import { ElectrumClient, type ElectrumClientEvents, type RequestResponse } from '@electrum-cash/network';
import { binToHex, cashAddressToLockingBytecode } from '@bitauth/libauth';
import { CASHADDR_PREFIX, ELECTRUM_SERVERS } from './constants.js';
import type { Network, Utxo } from './types.js';

/** What receipt checks need from the chain. Implemented by NodElectrum; easy to fake in tests. */
export interface ChainReader {
  /** Address history, newest first (mempool entries first). */
  getHistory(address: string): Promise<{ txid: string; height: number }[]>;
  getTransactionHex(txid: string): Promise<string>;
}

const APPLICATION = 'nod';
const PROTOCOL_VERSION = '1.5';

interface RawTokenData {
  category: string;
  amount: string | number | bigint;
  nft?: { capability: 'none' | 'mutable' | 'minting'; commitment: string };
}

interface RawUnspent {
  tx_hash: string;
  tx_pos: number | bigint;
  value: number | bigint;
  height: number | bigint;
  token_data?: RawTokenData;
}

interface RawHistory {
  tx_hash: string;
  height: number | bigint;
}

const toNumber = (v: unknown): number => (typeof v === 'bigint' ? Number(v) : Number(v));
const toBigInt = (v: unknown): bigint => {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  if (typeof v === 'string') return BigInt(v);
  throw new Error(`Expected an integer, got ${typeof v}`);
};

/** Parse "host" or "host:port"; Fulcrum's default WSS port is 50004. */
const parseServer = (server: string): { host: string; port: number } => {
  const stripped = server.replace(/^wss?:\/\//, '');
  const m = /^(.+?):(\d+)$/.exec(stripped);
  return m ? { host: m[1]!, port: Number(m[2]) } : { host: stripped, port: 50004 };
};

/** Sort history newest first: unconfirmed (height <= 0) before confirmed, then by height desc. */
export function sortHistoryNewestFirst<T extends { height: number }>(items: T[]): T[] {
  const rank = (h: number) => (h <= 0 ? Number.MAX_SAFE_INTEGER : h);
  return [...items].sort((a, b) => rank(b.height) - rank(a.height));
}

export class NodElectrum implements ChainReader {
  readonly network: Network;
  readonly servers: string[];
  private client: ElectrumClient<ElectrumClientEvents> | null = null;
  private connecting: Promise<void> | null = null;

  constructor(network: Network, servers?: string[]) {
    this.network = network;
    this.servers = servers && servers.length > 0 ? servers : ELECTRUM_SERVERS[network];
  }

  /** Connect to the first server that answers. Safe to call more than once. */
  async connect(): Promise<void> {
    if (this.client) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const errors: string[] = [];
      for (const server of this.servers) {
        const { host, port } = parseServer(server);
        const client = new ElectrumClient<ElectrumClientEvents>(APPLICATION, PROTOCOL_VERSION, host, {
          port,
          encrypted: true,
          useBigInt: true,
        });
        try {
          await client.connect();
          this.client = client;
          return;
        } catch (e) {
          errors.push(`${server}: ${e instanceof Error ? e.message : String(e)}`);
          try {
            await client.disconnect(true);
          } catch {
            /* ignore */
          }
        }
      }
      throw new Error(`Could not connect to any Electrum server (${errors.join('; ')})`);
    })();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client) await client.disconnect(true);
  }

  private async request(method: string, ...params: (string | number | boolean)[]): Promise<RequestResponse> {
    if (!this.client) await this.connect();
    const result = await this.client!.request(method, ...params);
    if (result instanceof Error) throw new Error(`${method} failed: ${result.message}`);
    return result;
  }

  private checkAddress(address: string): Uint8Array {
    const decoded = cashAddressToLockingBytecode(address);
    if (typeof decoded === 'string') throw new Error(`Invalid address ${address}: ${decoded}`);
    if (decoded.prefix !== CASHADDR_PREFIX[this.network]) {
      throw new Error(`Address ${address} is not a ${this.network} address`);
    }
    return decoded.bytecode;
  }

  async getUtxos(address: string): Promise<Utxo[]> {
    const lockingBytecode = binToHex(this.checkAddress(address));
    const raw = (await this.request('blockchain.address.listunspent', address, 'include_tokens')) as unknown as RawUnspent[];
    return raw.map((u) => {
      const utxo: Utxo = {
        txid: u.tx_hash,
        vout: toNumber(u.tx_pos),
        satoshis: toBigInt(u.value),
        lockingBytecode,
      };
      if (u.token_data) {
        utxo.token = {
          category: u.token_data.category,
          amount: toBigInt(u.token_data.amount ?? 0),
          ...(u.token_data.nft
            ? { nft: { capability: u.token_data.nft.capability, commitment: u.token_data.nft.commitment ?? '' } }
            : {}),
        };
      }
      return utxo;
    });
  }

  async getHistory(address: string): Promise<{ txid: string; height: number }[]> {
    this.checkAddress(address);
    const raw = (await this.request('blockchain.address.get_history', address)) as unknown as RawHistory[];
    return sortHistoryNewestFirst(raw.map((h) => ({ txid: h.tx_hash, height: toNumber(h.height) })));
  }

  async getTransactionHex(txid: string): Promise<string> {
    const hex = await this.request('blockchain.transaction.get', txid, false);
    if (typeof hex !== 'string') throw new Error(`Unexpected response for transaction ${txid}`);
    return hex;
  }

  /** Broadcast a signed transaction; resolves with its txid. */
  async broadcast(txHex: string): Promise<string> {
    const txid = await this.request('blockchain.transaction.broadcast', txHex);
    if (typeof txid !== 'string') throw new Error('Unexpected broadcast response');
    return txid;
  }

  async getBlockHeight(): Promise<number> {
    const tip = (await this.request('blockchain.headers.get_tip').catch(() =>
      this.request('blockchain.headers.subscribe'),
    )) as unknown as { height: number | bigint };
    return toNumber(tip.height);
  }
}
