import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { expect } from "chai";
import hre from "hardhat";
import { parseAbi, type Abi } from "viem";

// Other packages hand-write these ABIs from docs/PROTOCOL.md, so the compiled ABIs must match the
// spec's declarations exactly: names, argument order, types, indexed flags and struct fields.
const PROTOCOL_MD = path.join(__dirname, "..", "..", "docs", "PROTOCOL.md");
const ABI_DIR = path.join(__dirname, "..", "abi");

// Errors the contracts add on top of the spec (PROTOCOL.md defines none for NodPolicy).
const EXTRA_ERRORS: Record<"NodReceipts" | "NodPolicy", string[]> = {
  NodReceipts: [],
  NodPolicy: [
    "error CapExceeded(uint256 available, uint256 amount)",
    "error InvalidLimits()",
    "error PayeeNotAllowed(address owner, address agent, address payee)",
    "error PolicyInactive(address owner, address agent, address token)",
    "error ReentrancyGuardReentrantCall()", // OpenZeppelin ReentrancyGuard
    "error SafeERC20FailedOperation(address token)", // OpenZeppelin SafeERC20
    "error ZeroAddress()",
    "error ZeroAmount()",
  ],
};

/** The Solidity declarations in the ```solidity block of the PROTOCOL.md section titled with `contract`. */
function specDeclarations(contract: string): string[] {
  const doc = readFileSync(PROTOCOL_MD, "utf8").replace(/\r\n/g, "\n");
  const section = doc.split(/^## /m).find((s) => s.split("\n", 1)[0].includes(`\`${contract}\``));
  const block = section === undefined ? null : /```solidity\n([\s\S]*?)```/.exec(section);
  if (block === null) throw new Error(`No solidity block for ${contract} in ${PROTOCOL_MD}`);
  return block[1]
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trim().replace(/;$/, "").trim())
    .filter((line) => line.length > 0);
}

interface Param {
  type: string;
  name?: string;
  indexed?: boolean;
  components?: readonly Param[];
}

function formatParam(param: Param): string {
  const type = param.type.startsWith("tuple")
    ? `(${(param.components ?? []).map(formatParam).join(", ")})${param.type.slice("tuple".length)}`
    : param.type;
  return [type, param.indexed ? "indexed" : "", param.name ?? ""].filter(Boolean).join(" ");
}

/** A human-readable signature that keeps parameter names, e.g. `event X(address indexed a, uint256 b)`. */
function formatItem(item: Abi[number]): string {
  switch (item.type) {
    case "function": {
      const mutability = item.stateMutability === "nonpayable" ? "" : ` ${item.stateMutability}`;
      const outputs = item.outputs.length > 0 ? ` returns (${item.outputs.map(formatParam).join(", ")})` : "";
      return `function ${item.name}(${item.inputs.map(formatParam).join(", ")})${mutability}${outputs}`;
    }
    case "event":
    case "error":
      return `${item.type} ${item.name}(${item.inputs.map(formatParam).join(", ")})`;
    default:
      return item.type;
  }
}

function signatures(abi: Abi, type: "function" | "event" | "error"): string[] {
  return abi
    .filter((item) => item.type === type)
    .map(formatItem)
    .sort();
}

describe("ABI", function () {
  for (const name of ["NodReceipts", "NodPolicy"] as const) {
    describe(name, function () {
      it("matches docs/PROTOCOL.md exactly", async function () {
        const compiled = (await hre.artifacts.readArtifact(name)).abi as Abi;
        const spec = parseAbi(specDeclarations(name));

        expect(signatures(compiled, "function")).to.deep.equal(signatures(spec, "function"));
        expect(signatures(compiled, "event")).to.deep.equal(signatures(spec, "event"));
        expect(signatures(compiled, "error")).to.deep.equal([...signatures(spec, "error"), ...EXTRA_ERRORS[name]].sort());
        // No constructor arguments, fallback or receive.
        expect(compiled.filter((item) => !["function", "event", "error"].includes(item.type))).to.deep.equal([]);
      });

      it(`abi/${name}.json is up to date (npm run export-abi)`, async function () {
        const file = path.join(ABI_DIR, `${name}.json`);
        expect(existsSync(file), `${file} is missing: run npm run export-abi`).to.equal(true);
        const { abi } = await hre.artifacts.readArtifact(name);
        expect(JSON.parse(readFileSync(file, "utf8"))).to.deep.equal(abi);
      });
    });
  }
});
