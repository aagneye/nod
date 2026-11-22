import { WALLET_INSTALL_LINKS } from '../config';
import { ApiError } from './api';

export interface FriendlyError {
  text: string;
  /** Extra line in mono, e.g. the server's own message. */
  detail?: string;
  links?: ReadonlyArray<{ label: string; href: string }>;
}

export type WalletErrorCode =
  | 'no_wallet'
  | 'closed'
  | 'no_account'
  | 'wrong_chain'
  | 'unsupported_chain'
  | 'bad_signature';

/** Errors the wallet layer raises itself (as opposed to errors the wallet returns). */
export class WalletError extends Error {
  readonly code: WalletErrorCode;
  constructor(code: WalletErrorCode, message: string) {
    super(message);
    this.name = 'WalletError';
    this.code = code;
  }
}

export const noWalletError = (): WalletError =>
  new WalletError('no_wallet', 'No browser wallet found. Install OKX Wallet or MetaMask, then reload this page.');

/** Numeric EIP-1193 / JSON-RPC error code, looking through the wrappers some wallets add. */
export function rpcErrorCode(error: unknown, depth = 0): number | undefined {
  if (!error || typeof error !== 'object' || depth > 4) return undefined;
  const e = error as { code?: unknown; data?: { originalError?: unknown }; cause?: unknown; error?: unknown };
  if (typeof e.code === 'number') return e.code;
  if (typeof e.code === 'string' && /^-?\d+$/.test(e.code)) return Number(e.code);
  return (
    rpcErrorCode(e.data?.originalError, depth + 1) ?? rpcErrorCode(e.cause, depth + 1) ?? rpcErrorCode(e.error, depth + 1)
  );
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return (error as { shortMessage?: string }).shortMessage ?? error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return String(error);
}

export const isUserRejection = (error: unknown): boolean =>
  rpcErrorCode(error) === 4001 ||
  /user (rejected|denied|cancel+ed)|rejected by (the )?user|request rejected|user disapproved|action_rejected/i.test(
    errorMessage(error),
  );

export type ErrorContext = 'connect' | 'switch' | 'sign' | 'start' | 'finish' | 'other';

const REJECTED: Record<ErrorContext, string> = {
  connect: 'You declined the connection request in your wallet.',
  switch: 'You declined the network switch in your wallet. Nothing was paid.',
  sign: 'You declined the signature in your wallet. Nothing was paid.',
  start: 'You declined the request in your wallet.',
  finish: 'You declined the request in your wallet.',
  other: 'You declined the request in your wallet.',
};

/** Turn wallet and API errors into one sentence a payer can act on. */
export function friendlyError(error: unknown, context: ErrorContext = 'other'): FriendlyError {
  if (error instanceof WalletError) {
    return error.code === 'no_wallet' ? { text: error.message, links: WALLET_INSTALL_LINKS } : { text: error.message };
  }
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'hsp_unavailable':
        return {
          text: 'HSP, the HashKey Settlement Platform that executes Nod payments, is not reachable from the Nod server right now. Nothing was charged. Try again in a few minutes.',
          detail: error.message,
        };
      case 'quote_expired':
        return { text: 'The HSP quote expired before your signature arrived. Get a new quote and sign again.' };
      case 'hsp_error':
        return { text: 'HSP returned an error while handling the payment. Nothing was charged.', detail: error.message };
      case 'hsp_mismatch':
        return {
          text: "HSP's answer did not match the agent's terms, so Nod stopped before anything was signed or paid.",
          detail: error.message,
        };
      case 'no_payment_option':
        return { text: 'HSP offers no payment token Nod can use right now. Nothing was charged.', detail: error.message };
      case 'not_configured':
        return { text: 'This Nod server is missing a setting, so it cannot take payments yet.', detail: error.message };
      case 'chain_unavailable':
        return { text: 'The Nod server could not reach the blockchain right now. Try again in a moment.', detail: error.message };
      case 'not_paid':
        return { text: 'HSP does not report this payment as paid yet.', detail: error.message };
      case 'invalid_terms':
        return { text: 'The server rejected these terms: the signature or a field is not valid.', detail: error.message };
      case 'expired':
        return { text: 'These terms have expired. Ask the agent for a fresh link.' };
      case 'network':
      case 'bad_response':
        return { text: error.message };
      default:
        return error.status >= 500
          ? { text: 'The Nod server hit an error. Nothing was charged. Try again in a moment.', detail: error.message }
          : { text: error.message };
    }
  }

  const code = rpcErrorCode(error);
  const message = errorMessage(error);
  if (isUserRejection(error)) return { text: REJECTED[context] };
  if (code === -32002) {
    return { text: 'Your wallet already has a request waiting. Open the wallet extension to finish or cancel it.' };
  }
  if (code === 4100) return { text: 'Your wallet has not authorized Nod for this account. Connect it again.' };
  if (code === 4900 || code === 4901) {
    return { text: 'Your wallet is not connected to that network right now. Check the wallet and try again.' };
  }
  if (/chain ?id.*must match|does not match the active chain|chain mismatch|wrong (chain|network)/i.test(message)) {
    return {
      text: 'Your wallet is on a different network than the payment. Let Nod switch it, or switch it yourself, then sign again.',
      detail: message,
    };
  }
  return { text: message || 'Something went wrong.' };
}
