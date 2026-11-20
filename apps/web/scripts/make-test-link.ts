/**
 * Dev helper (Person B): mint a real signed Nod request link for manual testing.
 * Run: npx tsx apps/web/scripts/make-test-link.ts [vendor-cashaddr]
 *
 * Uses the protocol's own createRequest — a real Schnorr signature over the
 * request hash, exactly what the agent tool produces. With no argument it
 * makes a throwaway chipnet vendor address.
 */
import {
  encodeCashAddress,
  generatePrivateKey,
  hash160,
  secp256k1,
} from '@bitauth/libauth';
import { buildRequestUrl, createRequest, generateAgentKey, hashRequest, toHex } from '@nod/protocol';

const randomVendor = (): string => {
  const priv = generatePrivateKey(() => crypto.getRandomValues(new Uint8Array(32)));
  const pub = secp256k1.derivePublicKeyCompressed(priv);
  if (pub instanceof Error) throw pub;
  return encodeCashAddress({ payload: hash160(pub), prefix: 'bchtest', throwErrors: true, type: 'p2pkh' }).address;
};

const vendor = process.argv[2] || randomVendor();

const { privateKey } = generateAgentKey();
const signed = createRequest(
  {
    agentName: 'Dev Test Agent',
    vendor,
    amount: { sats: 1000 },
    purpose: 'Test payment for Nod web app smoke test',
    expiry: Math.floor(Date.now() / 1000) + 3600,
  },
  privateKey,
);

console.log(buildRequestUrl('http://localhost:5173', signed));
console.log('vendor:', vendor);
console.log('hash:', toHex(hashRequest(signed.req)));
