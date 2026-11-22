import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAddress, type Hex } from 'viem';

/** A recipient address for test terms. */
export const PAY_TO = getAddress('0x24b1ffb060a2e9b70a984add79105f149a61c02a');
export const SETTLEMENT_TX: Hex = `0x${'ab'.repeat(32)}`;

/** Fresh environment with an empty NOD_HOME in the OS temp dir. */
export const tempEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  NOD_HOME: mkdtempSync(join(tmpdir(), 'nod-agent-test-')),
  NOD_BASE_URL: 'https://nod.example',
  ...extra,
});

/**
 * A fake Nod server answering GET /api/receipt: anchored for the termsHashes in `paid`,
 * not anchored otherwise. Records the URLs it was called with.
 */
export const fakeReceiptServer = (opts: { paid?: string[]; contract?: string | null } = {}) => {
  const urls: string[] = [];
  const contract = opts.contract === undefined ? '0x5555555555555555555555555555555555555555' : opts.contract;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const termsHash = new URL(url).searchParams.get('termsHash') ?? '';
    const anchored = (opts.paid ?? []).map((h) => h.toLowerCase()).includes(termsHash.toLowerCase());
    const body = anchored
      ? {
          anchored: true,
          termsHash,
          chainId: 133,
          contract,
          recorder: '0x1111111111111111111111111111111111111111',
          receipt: {
            settlementTx: SETTLEMENT_TX,
            chainId: 11155111,
            payer: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
            payTo: PAY_TO,
            amount: '100000',
            anchoredAt: 1_900_000_000,
            settlementExplorerUrl: `https://sepolia.etherscan.io/tx/${SETTLEMENT_TX}`,
          },
          explorer: { settlementTx: `https://sepolia.etherscan.io/tx/${SETTLEMENT_TX}` },
        }
      : { anchored: false, termsHash, chainId: 133, contract, recorder: contract ? '0x1111111111111111111111111111111111111111' : null, explorer: {}, ...(contract ? {} : { reason: 'NOD_RECEIPTS_ADDRESS is not set' }) };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetch: fetchImpl, urls };
};
