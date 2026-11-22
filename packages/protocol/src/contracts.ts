/**
 * ABIs for Nod's HSK Chain contracts (PROTOCOL §3 NodReceipts, §4 NodPolicy), written by hand
 * from the spec, plus the ERC-20 subset Nod uses and small read/encode helpers.
 */
import { z } from 'zod';
import { encodeFunctionData, getAddress, isAddress, type Address, type Hex, type PublicClient } from 'viem';

export const NOD_RECEIPTS_ABI = [
  {
    type: 'function',
    name: 'anchor',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'termsHash', type: 'bytes32' },
      { name: 'settlementTx', type: 'bytes32' },
      { name: 'chainId', type: 'uint256' },
      { name: 'payer', type: 'address' },
      { name: 'payTo', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'anchorBatch',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'termsHashes', type: 'bytes32[]' },
      { name: 'settlementTxs', type: 'bytes32[]' },
      { name: 'chainIds', type: 'uint256[]' },
      { name: 'payers', type: 'address[]' },
      { name: 'payTos', type: 'address[]' },
      { name: 'amounts', type: 'uint256[]' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'receiptOf',
    stateMutability: 'view',
    inputs: [
      { name: 'recorder', type: 'address' },
      { name: 'termsHash', type: 'bytes32' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'settlementTx', type: 'bytes32' },
          { name: 'chainId', type: 'uint256' },
          { name: 'payer', type: 'address' },
          { name: 'payTo', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'anchoredAt', type: 'uint64' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'isAnchored',
    stateMutability: 'view',
    inputs: [
      { name: 'recorder', type: 'address' },
      { name: 'termsHash', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'event',
    name: 'Anchored',
    anonymous: false,
    inputs: [
      { name: 'recorder', type: 'address', indexed: true },
      { name: 'termsHash', type: 'bytes32', indexed: true },
      { name: 'settlementTx', type: 'bytes32', indexed: false },
      { name: 'chainId', type: 'uint256', indexed: false },
      { name: 'payer', type: 'address', indexed: false },
      { name: 'payTo', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'error',
    name: 'AlreadyAnchored',
    inputs: [
      { name: 'recorder', type: 'address' },
      { name: 'termsHash', type: 'bytes32' },
    ],
  },
  { type: 'error', name: 'LengthMismatch', inputs: [] },
] as const;

export const NOD_POLICY_ABI = [
  {
    type: 'function',
    name: 'setPolicy',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agent', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'cap', type: 'uint128' },
      { name: 'period', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'allowPayee',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agent', type: 'address' },
      { name: 'payee', type: 'address' },
      { name: 'allowed', type: 'bool' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'revoke',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agent', type: 'address' },
      { name: 'token', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'pay',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'payee', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'termsHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'policyOf',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'agent', type: 'address' },
      { name: 'token', type: 'address' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'cap', type: 'uint128' },
          { name: 'period', type: 'uint64' },
          { name: 'periodStart', type: 'uint64' },
          { name: 'spent', type: 'uint128' },
          { name: 'active', type: 'bool' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'isPayeeAllowed',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'agent', type: 'address' },
      { name: 'payee', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'event',
    name: 'PolicySet',
    anonymous: false,
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'agent', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'cap', type: 'uint128', indexed: false },
      { name: 'period', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PayeeAllowed',
    anonymous: false,
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'agent', type: 'address', indexed: true },
      { name: 'payee', type: 'address', indexed: true },
      { name: 'allowed', type: 'bool', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PolicyRevoked',
    anonymous: false,
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'agent', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'PolicyPaid',
    anonymous: false,
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'agent', type: 'address', indexed: true },
      { name: 'payee', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'termsHash', type: 'bytes32', indexed: false },
    ],
  },
  { type: 'error', name: 'CapExceeded', inputs: [{ name: 'available', type: 'uint256' }, { name: 'amount', type: 'uint256' }] },
  { type: 'error', name: 'InvalidLimits', inputs: [] },
  { type: 'error', name: 'PayeeNotAllowed', inputs: [{ name: 'owner', type: 'address' }, { name: 'agent', type: 'address' }, { name: 'payee', type: 'address' }] },
  { type: 'error', name: 'PolicyInactive', inputs: [{ name: 'owner', type: 'address' }, { name: 'agent', type: 'address' }, { name: 'token', type: 'address' }] },
  { type: 'error', name: 'ReentrancyGuardReentrantCall', inputs: [] },
  { type: 'error', name: 'SafeERC20FailedOperation', inputs: [{ name: 'token', type: 'address' }] },
  { type: 'error', name: 'ZeroAddress', inputs: [] },
  { type: 'error', name: 'ZeroAmount', inputs: [] },
] as const;

/** The ERC-20 subset Nod uses. */
export const ERC20_ABI = [
  {
    type: 'event',
    name: 'Transfer',
    anonymous: false,
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** NodReceipts.Receipt as viem decodes it. */
export interface NodReceipt {
  settlementTx: Hex;
  chainId: bigint;
  payer: Address;
  payTo: Address;
  amount: bigint;
  anchoredAt: bigint;
}

/** NodPolicy.Policy as viem decodes it. */
export interface NodPolicy {
  cap: bigint;
  period: bigint;
  periodStart: bigint;
  spent: bigint;
  active: boolean;
}

/** Arguments of NodReceipts.anchor. */
export interface AnchorArgs {
  termsHash: Hex;
  /** Settlement transaction hash on the payment network. */
  settlementTx: Hex;
  /** Chain id of the payment network. */
  chainId: number | bigint;
  payer: Address;
  payTo: Address;
  /** Token base units transferred. */
  amount: bigint;
}

/** Where Nod's contracts live on one chain. */
export interface NodDeployment {
  chainId: number;
  NodReceipts: Address;
  NodPolicy: Address;
}

/** Deployments keyed by chain id. */
export type NodDeployments = Record<number, NodDeployment>;

/** Anything with viem's PublicClient.readContract (a PublicClient for HSK Chain, typically). */
export type ContractReader = Pick<PublicClient, 'readContract'>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The receipt `recorder` anchored for `termsHash`, or null when there is none. */
export async function readReceipt(
  client: ContractReader,
  contract: Address,
  recorder: Address,
  termsHash: Hex,
): Promise<NodReceipt | null> {
  const receipt = await client.readContract({
    address: contract,
    abi: NOD_RECEIPTS_ABI,
    functionName: 'receiptOf',
    args: [recorder, termsHash],
  });
  if (receipt.anchoredAt === 0n) return null;
  return {
    settlementTx: receipt.settlementTx,
    chainId: receipt.chainId,
    payer: receipt.payer,
    payTo: receipt.payTo,
    amount: receipt.amount,
    anchoredAt: receipt.anchoredAt,
  };
}

/** True once `recorder` has anchored `termsHash`. */
export async function isAnchored(
  client: ContractReader,
  contract: Address,
  recorder: Address,
  termsHash: Hex,
): Promise<boolean> {
  return client.readContract({
    address: contract,
    abi: NOD_RECEIPTS_ABI,
    functionName: 'isAnchored',
    args: [recorder, termsHash],
  });
}

/** Calldata for NodReceipts.anchor (send it to the NodReceipts address). */
export function encodeAnchorCall(args: AnchorArgs): Hex {
  return encodeFunctionData({
    abi: NOD_RECEIPTS_ABI,
    functionName: 'anchor',
    args: [args.termsHash, args.settlementTx, BigInt(args.chainId), args.payer, args.payTo, args.amount],
  });
}

const deploymentAddress = z
  .string()
  .refine((value) => isAddress(value, { strict: false }), { message: 'must be an address' })
  .transform((value) => getAddress(value));

const deploymentSchema = z.object({
  chainId: z.number().int().positive(),
  NodReceipts: deploymentAddress,
  NodPolicy: deploymentAddress,
});

/** Validate a deployments record (e.g. a deployments JSON file); addresses come back checksummed. */
export function parseDeployment(raw: unknown): NodDeployment {
  const result = deploymentSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid Nod deployment: ${issues.join('; ')}`);
  }
  return { chainId: result.data.chainId, NodReceipts: result.data.NodReceipts, NodPolicy: result.data.NodPolicy };
}
