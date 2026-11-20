/** Vercel function entry for /api/demo-agent (bundled by scripts/build-vercel.mjs). */
import { handleDemoAgent } from '../demoAgent.js';
import { toNodeHandler } from '../node-adapter.js';

export default toNodeHandler((request) => handleDemoAgent(request));
