import { encodeCashAddress, hash160 } from '@bitauth/libauth';
import { CASHADDR_PREFIX } from '@nod/protocol';
import { NETWORK } from '../config';

/** Compressed secp256k1 pubkey → cashaddr for the configured network. */
export const addressFromPubkey = (pubkey: Uint8Array): string =>
  encodeCashAddress({ payload: hash160(pubkey), prefix: CASHADDR_PREFIX[NETWORK], throwErrors: true, type: 'p2pkh' })
    .address;

/** bitcoincash:qqqq… → qqqq… for compact display. */
export const shortAddress = (address: string, keep = 8): string => {
  const bare = address.includes(':') ? address.slice(address.indexOf(':') + 1) : address;
  return bare.length <= keep * 2 + 1 ? bare : `${bare.slice(0, keep)}…${bare.slice(-keep)}`;
};
