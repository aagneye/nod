/**
 * Vercel function entry: every /api route, dispatched by path (bundled by scripts/build-vercel.mjs
 * into one function per route).
 *
 * The HSP routes (/api/pay/*, /api/vendor/buy and the HSP probe in /api/config) will answer
 * 503 hsp_unavailable here: HSP only accepts allowlisted IPs, and Vercel functions have no
 * fixed IP. Run the standalone server on an allowlisted machine for those (see standalone.ts).
 */
import { handleApiRequest } from './api.js';
import { toNodeHandler } from './node-adapter.js';

export default toNodeHandler(handleApiRequest);
