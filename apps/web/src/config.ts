/**
 * Build-time settings for the web app. Everything network-specific (chains, contract
 * addresses, the HSP payment token) comes from the server at runtime via GET /api/config.
 */

/** Origin serving the /api routes; empty means the app's own origin. */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').trim().replace(/\/+$/, '');

export const REPO_URL = 'https://github.com/aagneye/nod';

/** Prefix for links to files in the repo. */
export const REPO_BLOB_URL = `${REPO_URL}/blob/main`;

/** Credit: the project that inspired Nod. */
export const REQUISITION_URL = 'https://dorahacks.io/build/50833';

/** Where to send someone who has no browser wallet yet. */
export const WALLET_INSTALL_LINKS = [
  { label: 'Get OKX Wallet', href: 'https://web3.okx.com/' },
  { label: 'Get MetaMask', href: 'https://metamask.io/download/' },
] as const;
