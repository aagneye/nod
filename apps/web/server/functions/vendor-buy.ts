/** Vercel function entry for /api/vendor/buy (bundled by scripts/build-vercel.mjs). */
import { toNodeHandler } from '../node-adapter.js';
import { handleVendorBuy } from '../vendor.js';

export default toNodeHandler((request) => handleVendorBuy(request));
