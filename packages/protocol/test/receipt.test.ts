import { describe, expect, it } from 'vitest';
import {
  createPublicClient,
  encodeAbiParameters,
  encodeEventTopics,
  http,
  parseAbi,
  type Address,
  type Hash,
  type Hex,
} from 'viem';
import {
  ERC20_ABI,
  TRANSFER_TOPIC,
  checkSettlement,
  hskTestnet,
  usdToRaw,
  type SettlementClient,
  type SettlementLog,
  type SettlementReceipt,
} from '../src/index.js';
import { HSK_TEST_USDC, HSK_TEST_USDT, OTHER, PAYER, VENDOR } from './fixtures.js';

const TX: Hash = `0x${'cd'.repeat(32)}`;
const MIN = usdToRaw('12.50', 6);

function transferLog(token: Address, from: Address, to: Address, value: bigint): SettlementLog {
  return {
    address: token,
    topics: encodeEventTopics({ abi: ERC20_ABI, eventName: 'Transfer', args: { from, to } }) as Hex[],
    data: encodeAbiParameters([{ type: 'uint256' }], [value]),
  };
}

const APPROVAL_ABI = parseAbi(['event Approval(address indexed owner, address indexed spender, uint256 value)']);
const approvalLog: SettlementLog = {
  address: HSK_TEST_USDC,
  topics: encodeEventTopics({ abi: APPROVAL_ABI, eventName: 'Approval', args: { owner: PAYER, spender: VENDOR } }) as Hex[],
  data: encodeAbiParameters([{ type: 'uint256' }], [MIN]),
};

function fakeClient(receipt: SettlementReceipt | Error): SettlementClient & { calls: Hash[] } {
  const calls: Hash[] = [];
  return {
    calls,
    async getTransactionReceipt({ hash }) {
      calls.push(hash);
      if (receipt instanceof Error) throw receipt;
      return receipt;
    },
  };
}

const check = (receipt: SettlementReceipt | Error, overrides: Partial<Parameters<typeof checkSettlement>[0]> = {}) =>
  checkSettlement({
    client: fakeClient(receipt),
    txHash: TX,
    token: HSK_TEST_USDC,
    payer: PAYER,
    payTo: VENDOR,
    minRaw: MIN,
    ...overrides,
  });

describe('checkSettlement', () => {
  it('passes for a successful Transfer from payer to payTo of at least minRaw', async () => {
    const client = fakeClient({
      status: 'success',
      logs: [
        transferLog(HSK_TEST_USDT, PAYER, VENDOR, MIN), // other token
        approvalLog, // other event
        transferLog(HSK_TEST_USDC, PAYER, VENDOR, MIN),
      ],
    });
    const result = await checkSettlement({ client, txHash: TX, token: HSK_TEST_USDC, payer: PAYER, payTo: VENDOR, minRaw: MIN });
    expect(result).toEqual({ ok: true, reasons: [], transferredRaw: MIN });
    expect(client.calls).toEqual([TX]);
  });

  it('compares addresses case-insensitively and accepts overpayment', async () => {
    const receipt = { status: 'success', logs: [transferLog(HSK_TEST_USDC, PAYER, VENDOR, MIN + 1n)] };
    receipt.logs[0]!.address = HSK_TEST_USDC.toUpperCase().replace('0X', '0x');
    const result = await check(receipt, {
      token: HSK_TEST_USDC.toLowerCase() as Address,
      payer: PAYER.toLowerCase() as Address,
      payTo: VENDOR.toLowerCase() as Address,
    });
    expect(result).toEqual({ ok: true, reasons: [], transferredRaw: MIN + 1n });
  });

  it('fails when the Transfer went to someone else', async () => {
    const result = await check({ status: 'success', logs: [transferLog(HSK_TEST_USDC, PAYER, OTHER, MIN)] });
    expect(result.ok).toBe(false);
    expect(result.transferredRaw).toBeUndefined();
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toMatch(new RegExp(`No Transfer of .* to ${VENDOR}; found ${PAYER} -> ${OTHER}`));
  });

  it('fails when the Transfer came from someone else', async () => {
    const result = await check({ status: 'success', logs: [transferLog(HSK_TEST_USDC, OTHER, VENDOR, MIN)] });
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toMatch(/No Transfer of/);
  });

  it('fails when the Transfer is too small', async () => {
    const result = await check({
      status: 'success',
      logs: [transferLog(HSK_TEST_USDC, PAYER, VENDOR, MIN - 2n), transferLog(HSK_TEST_USDC, PAYER, VENDOR, MIN - 1n)],
    });
    expect(result).toEqual({
      ok: false,
      reasons: [`Transfer of ${MIN - 1n} is less than the ${MIN} required`],
      transferredRaw: MIN - 1n,
    });
  });

  it('fails for a reverted transaction', async () => {
    const result = await check({ status: 'reverted', logs: [] });
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toMatch(/did not succeed \(status: reverted\)/);
  });

  it('fails when the token Transfer log is missing', async () => {
    for (const logs of [
      [],
      [approvalLog],
      [transferLog(HSK_TEST_USDT, PAYER, VENDOR, MIN)],
      // ERC-721 style Transfer (tokenId indexed, 4 topics) from the token address
      [
        {
          address: HSK_TEST_USDC,
          topics: [...(transferLog(HSK_TEST_USDC, PAYER, VENDOR, 0n).topics as Hex[]), encodeAbiParameters([{ type: 'uint256' }], [MIN])],
          data: '0x' as Hex,
        },
      ],
      // right topic but truncated data
      [{ ...transferLog(HSK_TEST_USDC, PAYER, VENDOR, MIN), data: '0x1234' as Hex }],
    ]) {
      const result = await check({ status: 'success', logs });
      expect(result.ok).toBe(false);
      expect(result.reasons[0]).toMatch(/has no Transfer of token/);
    }
  });

  it('reports a receipt that cannot be fetched', async () => {
    const result = await check(new Error('Transaction receipt with hash "0xcd..." could not be found.'));
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toMatch(/Could not get the receipt .* could not be found/);
  });

  it('throws on invalid arguments', async () => {
    const ok = { status: 'success', logs: [] };
    await expect(check(ok, { txHash: '0x1234' as Hash })).rejects.toThrow(/txHash/);
    await expect(check(ok, { token: 'nope' as Address })).rejects.toThrow(/token/);
    await expect(check(ok, { payTo: '0x12' as Address })).rejects.toThrow(/payTo/);
    await expect(check(ok, { minRaw: -1n })).rejects.toThrow(/minRaw/);
  });

  it('uses the standard Transfer topic and accepts a viem PublicClient', () => {
    expect(TRANSFER_TOPIC).toBe('0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');
    // Compile-time check: a real PublicClient satisfies SettlementClient (no request is made).
    const client: SettlementClient = createPublicClient({ chain: hskTestnet, transport: http() });
    expect(typeof client.getTransactionReceipt).toBe('function');
  });
});
