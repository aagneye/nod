import { describe, expect, it } from 'vitest';
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  parseAbi,
  toFunctionSelector,
  type Abi,
  type Hex,
} from 'viem';
import {
  ERC20_ABI,
  NOD_POLICY_ABI,
  NOD_RECEIPTS_ABI,
  encodeAnchorCall,
  hskTestnet,
  isAnchored,
  parseDeployment,
  readReceipt,
  type NodReceipt,
} from '../src/index.js';
import { FIXED_TERMS_HASH, PAYER, VENDOR } from './fixtures.js';

/** PROTOCOL §3, verbatim. */
const SPEC_RECEIPTS = parseAbi([
  'struct Receipt { bytes32 settlementTx; uint256 chainId; address payer; address payTo; uint256 amount; uint64 anchoredAt; }',
  'event Anchored(address indexed recorder, bytes32 indexed termsHash, bytes32 settlementTx, uint256 chainId, address payer, address payTo, uint256 amount)',
  'error AlreadyAnchored(address recorder, bytes32 termsHash)',
  'error LengthMismatch()',
  'function anchor(bytes32 termsHash, bytes32 settlementTx, uint256 chainId, address payer, address payTo, uint256 amount) external',
  'function anchorBatch(bytes32[] calldata termsHashes, bytes32[] calldata settlementTxs, uint256[] calldata chainIds, address[] calldata payers, address[] calldata payTos, uint256[] calldata amounts) external',
  'function receiptOf(address recorder, bytes32 termsHash) external view returns (Receipt memory)',
  'function isAnchored(address recorder, bytes32 termsHash) external view returns (bool)',
]);

/** PROTOCOL §4, verbatim. */
const SPEC_POLICY = parseAbi([
  'struct Policy { uint128 cap; uint64 period; uint64 periodStart; uint128 spent; bool active; }',
  'error CapExceeded(uint256 available, uint256 amount)',
  'error InvalidLimits()',
  'error PayeeNotAllowed(address owner, address agent, address payee)',
  'error PolicyInactive(address owner, address agent, address token)',
  'error ReentrancyGuardReentrantCall()',
  'error SafeERC20FailedOperation(address token)',
  'error ZeroAddress()',
  'error ZeroAmount()',
  'event PolicySet(address indexed owner, address indexed agent, address indexed token, uint128 cap, uint64 period)',
  'event PayeeAllowed(address indexed owner, address indexed agent, address indexed payee, bool allowed)',
  'event PolicyRevoked(address indexed owner, address indexed agent, address indexed token)',
  'event PolicyPaid(address indexed owner, address indexed agent, address indexed payee, address token, uint256 amount, bytes32 termsHash)',
  'function setPolicy(address agent, address token, uint128 cap, uint64 period) external',
  'function allowPayee(address agent, address payee, bool allowed) external',
  'function revoke(address agent, address token) external',
  'function pay(address owner, address token, address payee, uint256 amount, bytes32 termsHash) external',
  'function policyOf(address owner, address agent, address token) external view returns (Policy memory)',
  'function isPayeeAllowed(address owner, address agent, address payee) external view returns (bool)',
]);

const SPEC_ERC20 = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

/** Drop spellings that do not change the ABI: unnamed outputs (`name: ''`), `anonymous: false`, `indexed: false`. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if ((k === 'name' && v === '') || ((k === 'anonymous' || k === 'indexed') && v === false)) continue;
      out[k] = canonical(v);
    }
    return out;
  }
  return value;
}

const byKey = (abi: Abi) =>
  new Map(abi.map((item) => [`${item.type}:${'name' in item ? item.name : ''}`, canonical(item)]));

describe('ABIs match docs/PROTOCOL.md exactly', () => {
  for (const [label, mine, spec] of [
    ['NodReceipts', NOD_RECEIPTS_ABI, SPEC_RECEIPTS],
    ['NodPolicy', NOD_POLICY_ABI, SPEC_POLICY],
    ['ERC-20 subset', ERC20_ABI, SPEC_ERC20],
  ] as const) {
    it(label, () => {
      const a = byKey(mine as Abi);
      const b = byKey(spec as Abi);
      expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
      for (const [key, item] of b) expect(a.get(key), key).toEqual(item);
    });
  }
});

describe('contract helpers', () => {
  const stored: NodReceipt = {
    settlementTx: `0x${'ab'.repeat(32)}`,
    chainId: 11155111n,
    payer: PAYER,
    payTo: VENDOR,
    amount: 12_500_000n,
    anchoredAt: 1_800_000_000n,
  };
  const NOD_RECEIPTS = '0x5555555555555555555555555555555555555555';

  /** A real viem client whose transport answers eth_call from `receipt`. */
  const clientFor = (receipt: NodReceipt) =>
    createPublicClient({
      chain: hskTestnet,
      transport: custom({
        async request({ method, params }: { method: string; params?: unknown }) {
          if (method === 'eth_chainId') return '0x85';
          if (method !== 'eth_call') throw new Error(`unexpected ${method}`);
          const [{ to, data }] = params as [{ to: string; data: Hex }];
          expect(to.toLowerCase()).toBe(NOD_RECEIPTS);
          const call = decodeFunctionData({ abi: NOD_RECEIPTS_ABI, data });
          expect(call.args?.[1]).toBe(FIXED_TERMS_HASH);
          if (call.functionName === 'receiptOf') {
            return encodeFunctionResult({ abi: NOD_RECEIPTS_ABI, functionName: 'receiptOf', result: receipt });
          }
          if (call.functionName === 'isAnchored') {
            return encodeFunctionResult({ abi: NOD_RECEIPTS_ABI, functionName: 'isAnchored', result: receipt.anchoredAt > 0n });
          }
          throw new Error(`unexpected call ${call.functionName}`);
        },
      }),
    });

  it('readReceipt decodes the Receipt tuple, or null when nothing is anchored', async () => {
    expect(await readReceipt(clientFor(stored), NOD_RECEIPTS, PAYER, FIXED_TERMS_HASH)).toEqual(stored);
    const empty: NodReceipt = {
      settlementTx: `0x${'00'.repeat(32)}`,
      chainId: 0n,
      payer: '0x0000000000000000000000000000000000000000',
      payTo: '0x0000000000000000000000000000000000000000',
      amount: 0n,
      anchoredAt: 0n,
    };
    expect(await readReceipt(clientFor(empty), NOD_RECEIPTS, PAYER, FIXED_TERMS_HASH)).toBeNull();
  });

  it('isAnchored reads the view function', async () => {
    expect(await isAnchored(clientFor(stored), NOD_RECEIPTS, PAYER, FIXED_TERMS_HASH)).toBe(true);
    expect(await isAnchored(clientFor({ ...stored, anchoredAt: 0n }), NOD_RECEIPTS, PAYER, FIXED_TERMS_HASH)).toBe(false);
  });

  it('encodeAnchorCall round-trips through the ABI', () => {
    const data = encodeAnchorCall({
      termsHash: FIXED_TERMS_HASH,
      settlementTx: stored.settlementTx,
      chainId: 11155111,
      payer: PAYER,
      payTo: VENDOR,
      amount: 12_500_000n,
    });
    expect(data.slice(0, 10)).toBe(toFunctionSelector('anchor(bytes32,bytes32,uint256,address,address,uint256)'));
    expect(decodeFunctionData({ abi: NOD_RECEIPTS_ABI, data })).toEqual({
      functionName: 'anchor',
      args: [FIXED_TERMS_HASH, stored.settlementTx, 11155111n, PAYER, VENDOR, 12_500_000n],
    });
  });

  it('parseDeployment checksums addresses and rejects bad records', () => {
    expect(
      parseDeployment({
        chainId: 133,
        NodReceipts: NOD_RECEIPTS,
        NodPolicy: VENDOR.toLowerCase(),
        deployedAt: 'ignored',
      }),
    ).toEqual({ chainId: 133, NodReceipts: NOD_RECEIPTS, NodPolicy: VENDOR });
    expect(() => parseDeployment({ chainId: 133, NodReceipts: '0x12', NodPolicy: VENDOR })).toThrow(/NodReceipts/);
    expect(() => parseDeployment({ NodReceipts: NOD_RECEIPTS, NodPolicy: VENDOR })).toThrow(/chainId/);
  });
});
