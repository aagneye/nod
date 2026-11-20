/** Every API endpoint, path to web-standard handler. Used by the Vite dev middleware. */
import { handleDemoAgent } from './demoAgent.js';
import type { Handler } from './http.js';
import { handleVendorBuy } from './vendor.js';

export const routes: Record<string, Handler> = {
  '/api/demo-agent': (request) => handleDemoAgent(request),
  '/api/vendor/buy': (request) => handleVendorBuy(request),
};
