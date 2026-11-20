/** Dev helper: fetch a real recent Chipnet txid via the live Electrum server. */
import { NodElectrum } from '@nod/protocol';

const chain = new NodElectrum('chipnet');
await chain.connect();
const raw = chain as unknown as { request: (m: string, ...p: unknown[]) => Promise<unknown> };
const height = await chain.getBlockHeight();
console.log('tip height:', height);
for (let h = height; h > height - 5; h--) {
  for (const pos of [0, 1, 2]) {
    try {
      const txid = await raw.request('blockchain.transaction.id_from_pos', h, pos, false);
      if (typeof txid === 'string' && /^[0-9a-f]{64}$/.test(txid)) {
        const hex = await chain.getTransactionHex(txid);
        console.log('REAL_TX', h, pos, txid, 'hexlen', hex.length);
        process.exit(0);
      }
    } catch {
      /* try next */
    }
  }
}
console.log('no txid found');
process.exit(1);
