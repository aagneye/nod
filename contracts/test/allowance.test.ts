import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compileFile } from 'cashc';
import { Contract, MockNetworkProvider, SignatureTemplate, TransactionBuilder, randomUtxo } from 'cashscript';
import { encodeCashAddress, hash160, secp256k1, sha256, utf8ToBin } from '@bitauth/libauth';

const artifact = compileFile(fileURLToPath(new URL('../src/allowance.cash', import.meta.url)));

const key = (seed: string) => {
  const privateKey = sha256.hash(utf8ToBin(`allowance-test-${seed}`));
  const publicKey = secp256k1.derivePublicKeyCompressed(privateKey) as Uint8Array;
  const pkh = hash160(publicKey);
  const address = encodeCashAddress({ prefix: 'bchtest', type: 'p2pkh', payload: pkh }).address;
  return { privateKey, publicKey, pkh, address, sig: new SignatureTemplate(privateKey) };
};

const owner = key('owner');
const agent = key('agent');
const vendor = key('vendor');
const stranger = key('stranger');

const CAP = 10_000n;
const PERIOD = 144n;
const FUNDS = 100_000n;

function setup() {
  const provider = new MockNetworkProvider();
  const contract = new Contract(artifact, [owner.pkh, agent.publicKey, vendor.pkh, CAP, PERIOD], { provider });
  const contractUtxo = provider.addUtxo(contract.address, randomUtxo({ satoshis: FUNDS }));
  const ownerUtxo = provider.addUtxo(owner.address, randomUtxo({ satoshis: 5_000n }));
  return { provider, contract, contractUtxo, ownerUtxo };
}

function agentSpend(
  opts: {
    pay?: bigint;
    to?: string;
    sequence?: number;
    fee?: bigint;
    signer?: SignatureTemplate;
    extra?: { to: string; amount: bigint } | { memo: string };
  } = {},
) {
  const { provider, contract, contractUtxo } = setup();
  const pay = opts.pay ?? 2_500n;
  const fee = opts.fee ?? 1_000n;
  const extraSats = opts.extra && 'amount' in opts.extra ? opts.extra.amount : 0n;
  const builder = new TransactionBuilder({ provider })
    .addInput(contractUtxo, contract.unlock.agentSpend!(opts.signer ?? agent.sig), {
      sequence: opts.sequence ?? Number(PERIOD),
    })
    .addOutput({ to: opts.to ?? vendor.address, amount: pay })
    .addOutput({ to: contract.address, amount: FUNDS - pay - fee - extraSats });
  if (opts.extra && 'memo' in opts.extra) builder.addOpReturnOutput(['NOD', opts.extra.memo]);
  else if (opts.extra) builder.addOutput({ to: opts.extra.to, amount: opts.extra.amount });
  return builder.send();
}

describe('Allowance contract', () => {
  it('lets the agent pay the vendor within the cap after the period', async () => {
    await expect(agentSpend()).resolves.toBeDefined();
    await expect(agentSpend({ pay: CAP })).resolves.toBeDefined();
  });

  it('allows a NOD memo as a third output', async () => {
    await expect(agentSpend({ extra: { memo: '0xab' } })).resolves.toBeDefined();
  });

  it('rejects a third output that sends sats to another address', async () => {
    // Fee slack would otherwise let the agent skim up to 2,000 sats per period.
    await expect(agentSpend({ fee: 500n, extra: { to: stranger.address, amount: 1_500n } })).rejects.toThrow(/require\(tx\.outputs\[2\]\.value == 0\)|Allowance\.cash:41/);
  });

  it('rejects a payment over the cap', async () => {
    await expect(agentSpend({ pay: CAP + 1n })).rejects.toThrow(/capSats/);
  });

  it('rejects a spend before the period has passed', async () => {
    await expect(agentSpend({ sequence: Number(PERIOD) - 1 })).rejects.toThrow(/this\.age/);
  });

  it('rejects paying a different vendor', async () => {
    await expect(agentSpend({ to: stranger.address })).rejects.toThrow(/vendorPkh/);
  });

  it('rejects a non-agent signature', async () => {
    await expect(agentSpend({ signer: stranger.sig })).rejects.toThrow(/checkSig/);
  });

  it('rejects a fee above the cap (remainder not returned)', async () => {
    await expect(agentSpend({ fee: 3_000n })).rejects.toThrow(/- 2000/);
  });

  it('lets the owner withdraw everything with one of their own coins', async () => {
    const { provider, contract, contractUtxo, ownerUtxo } = setup();
    await expect(
      new TransactionBuilder({ provider })
        .addInput(contractUtxo, contract.unlock.ownerWithdraw!(1n))
        .addInput(ownerUtxo, owner.sig.unlockP2PKH())
        .addOutput({ to: owner.address, amount: FUNDS + 5_000n - 1_000n })
        .send(),
    ).resolves.toBeDefined();
  });

  it('rejects a withdraw that pays someone else', async () => {
    const { provider, contract, contractUtxo, ownerUtxo } = setup();
    await expect(
      new TransactionBuilder({ provider })
        .addInput(contractUtxo, contract.unlock.ownerWithdraw!(1n))
        .addInput(ownerUtxo, owner.sig.unlockP2PKH())
        .addOutput({ to: stranger.address, amount: FUNDS + 5_000n - 1_000n })
        .send(),
    ).rejects.toThrow(/== ownerLock\)/);
  });

  it('rejects a withdraw without an owner coin', async () => {
    const { provider, contract, contractUtxo } = setup();
    const strangerUtxo = provider.addUtxo(stranger.address, randomUtxo({ satoshis: 5_000n }));
    await expect(
      new TransactionBuilder({ provider })
        .addInput(contractUtxo, contract.unlock.ownerWithdraw!(1n))
        .addInput(strangerUtxo, stranger.sig.unlockP2PKH())
        .addOutput({ to: stranger.address, amount: FUNDS + 5_000n - 1_000n })
        .send(),
    ).rejects.toThrow(/walletInputIndex\]/);
  });
});
