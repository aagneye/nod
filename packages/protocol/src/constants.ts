/** Protocol version carried in every set of terms (`NodTerms.v`). */
export const NOD_VERSION = 2;

/** Longest `merchant` accepted, in characters. */
export const MAX_MERCHANT_LENGTH = 64;

/** Longest `purpose` accepted, in characters. */
export const MAX_PURPOSE_LENGTH = 140;

/** Largest `amountUsd` accepted. */
export const MAX_AMOUNT_USD = '10000.00';

/** Lifetime `createTerms` gives terms when neither `expiresInSec` nor `expiry` is passed. */
export const DEFAULT_TERMS_TTL_SEC = 60 * 60;

/** HSP cart mandates expire at most this long after they are built. */
export const MAX_CART_TTL_SEC = 2 * 60 * 60;

/** Longest cart `display_items` label, in characters. */
export const MAX_DISPLAY_LABEL_LENGTH = 120;

/** Default HSP Agentic Payment MCP endpoint (Streamable HTTP, QA environment). */
export const HSP_DEFAULT_MCP_URL = 'https://mcp-qa.hashkeymerchant.com/';

/** `supported_methods` value of the x402 entry in a cart mandate. */
export const X402_METHOD = 'https://www.x402.org/';
