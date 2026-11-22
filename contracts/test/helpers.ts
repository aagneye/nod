import { ContractFunctionRevertedError, decodeErrorResult, isHex, keccak256, toHex, type Abi, type Hex } from "viem";

/** A decoded custom-error revert. */
export interface Revert {
  errorName: string;
  args: readonly unknown[];
}

/**
 * Finds the raw revert data in an error's cause chain. viem puts it on ContractFunctionRevertedError
 * when the node reports a standard RPC error; Hardhat's in-process network attaches it as `data`
 * to the innermost error instead.
 */
function revertDataOf(error: unknown): Hex | undefined {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if (current instanceof ContractFunctionRevertedError && current.raw) return current.raw;
    const data: unknown = (current as { data?: unknown }).data;
    const raw = typeof data === "object" && data !== null ? (data as { data?: unknown }).data : data;
    if (typeof raw === "string" && isHex(raw) && raw.length >= 10) return raw;
  }
  return undefined;
}

/**
 * Awaits `call`, which must revert, and decodes the revert data with `abi`.
 * Pass an ABI that includes every error the call can bubble up (for example the token's
 * errors when NodPolicy.pay reverts inside `transferFrom`).
 */
export async function revertOf(call: Promise<unknown>, abi: Abi): Promise<Revert> {
  try {
    await call;
  } catch (error) {
    const data = revertDataOf(error);
    if (data === undefined) throw error;
    const { errorName, args } = decodeErrorResult({ abi, data });
    return { errorName, args: args ?? [] };
  }
  throw new Error("expected the call to revert, but it succeeded");
}

/** A deterministic stand-in for an EIP-712 terms hash. */
export function termsHashOf(label: string): Hex {
  return keccak256(toHex(`nod-terms:${label}`));
}

/** A deterministic stand-in for a settlement transaction hash. */
export function txHashOf(label: string): Hex {
  return keccak256(toHex(`nod-settlement:${label}`));
}
