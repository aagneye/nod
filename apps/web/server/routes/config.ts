/** GET /api/config: contracts, HSP mode and reachability, the payment option and the demo price. */
import { getChain } from '@nod/protocol';
import { merchantNameFor } from '../config.js';
import type { ApiContext } from '../context.js';
import { HSP_ALLOWLIST_HINT, HspUnavailableError } from '../hsp.js';
import { paymentOptions, pickOption } from '../hsp-flow.js';
import { HttpError, errorMessage, json } from '../http.js';
import type { ConfigResponse } from '../types.js';

/** /api/config should answer quickly even when HSP does not (connecting alone may take 10 s). */
const PROBE_TIMEOUT_MS = 6_000;

/** Reject after `ms`; the probe keeps running and its result still lands in the cache. */
function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function handleConfig(ctx: ApiContext): Promise<Response> {
  const { cfg, hsp } = ctx;
  const merchantName = merchantNameFor(cfg, hsp.mode);
  const info: ConfigResponse['hsp'] = { mode: hsp.mode, merchantName, reachable: false };
  try {
    const options = await withTimeout(
      paymentOptions(ctx, { timeoutMs: PROBE_TIMEOUT_MS, reuseFailure: true }),
      PROBE_TIMEOUT_MS,
      () => new HspUnavailableError(`HSP at ${cfg.hsp.url} did not answer within ${PROBE_TIMEOUT_MS / 1000} s. ${HSP_ALLOWLIST_HINT}`),
    );
    info.reachable = true;
    try {
      info.option = pickOption(options, cfg.hsp.prefer);
    } catch (error) {
      info.error = errorMessage(error);
    }
  } catch (error) {
    // HSP answering with errors is still reachable; unavailable (network, 403) is not.
    info.reachable = error instanceof HttpError && error.code === 'hsp_error';
    info.error = errorMessage(error);
  }
  if (!merchantName && !info.error) {
    info.error = "NOD_MERCHANT_NAME is not set: payments need the team's HSP reporting name.";
  }

  const explorer = getChain(cfg.receipts.chainId).blockExplorers?.default.url ?? '';
  const body: ConfigResponse = {
    receipts: { chainId: cfg.receipts.chainId, address: cfg.receipts.address, recorder: cfg.receipts.recorder, explorer },
    policy: { chainId: cfg.policy.chainId, address: cfg.policy.address },
    hsp: info,
    demoUsd: cfg.demo.amountUsd,
  };
  return json(200, body);
}
