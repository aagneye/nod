/**
 * Writes the ABI arrays of NodReceipts and NodPolicy to contracts/abi/<Name>.json.
 * `hardhat run` compiles first, so the files always match the current sources.
 *
 *   npm run export-abi -w @nod/contracts
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import hre from "hardhat";

const EXPORTED_CONTRACTS = ["NodReceipts", "NodPolicy"] as const;

async function main(): Promise<void> {
  const dir = path.join(__dirname, "..", "abi");
  await mkdir(dir, { recursive: true });
  for (const name of EXPORTED_CONTRACTS) {
    const { abi } = await hre.artifacts.readArtifact(name);
    const file = path.join(dir, `${name}.json`);
    await writeFile(file, `${JSON.stringify(abi, null, 2)}\n`);
    console.log(`Wrote ${path.relative(process.cwd(), file)} (${abi.length} ABI entries)`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
