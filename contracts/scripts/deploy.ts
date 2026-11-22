/**
 * Deploys NodReceipts and NodPolicy and records them in deployments/<network>.json.
 *
 *   npm run deploy:hsk-testnet -w @nod/contracts
 *   npm run deploy:sepolia -w @nod/contracts
 *   CONFIRM_MAINNET=yes npm run deploy:hsk-mainnet -w @nod/contracts   (bash)
 *   $env:CONFIRM_MAINNET='yes'; npm run deploy:hsk-mainnet -w @nod/contracts   (PowerShell)
 *
 * The deployer key comes from DEPLOYER_PRIVATE_KEY (shell or contracts/.env). HSK Chain mainnet
 * additionally needs CONFIRM_MAINNET=yes in the shell; hardhat.config.ts ignores it in .env.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import hre from "hardhat";
import { formatEther, getAddress, type Address, type Hash } from "viem";

const HSK_MAINNET_CHAIN_ID = 177;

const EXPLORERS: Record<number, string> = {
  177: "https://hsk.blockscout.com",
  133: "https://testnet-explorer.hskchain.net",
  11155111: "https://sepolia.etherscan.io",
};

interface Deployed {
  address: Address;
  txHash: Hash;
  block: number;
}

function assertMainnetConfirmed(reason: string): void {
  if (process.env.CONFIRM_MAINNET === "yes") return;
  throw new Error(
    `Refusing to deploy to HSK Chain mainnet (${reason}). ` +
      "Set CONFIRM_MAINNET=yes in the shell for this one command (it is ignored in .env).",
  );
}

/** Waits for a deployment sent with hre.viem.sendDeploymentTransaction and returns what to record. */
async function confirmDeployment(
  name: string,
  sent: Promise<{ contract: { address: Address }; deploymentTransaction: { hash: Hash } }>,
): Promise<Deployed> {
  const publicClient = await hre.viem.getPublicClient();
  const { contract, deploymentTransaction } = await sent;
  console.log(`${name}: sent ${deploymentTransaction.hash}, waiting for the receipt...`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: deploymentTransaction.hash });
  if (receipt.status !== "success") {
    throw new Error(`${name} deployment reverted (tx ${deploymentTransaction.hash})`);
  }
  return {
    address: getAddress(receipt.contractAddress ?? contract.address),
    txHash: deploymentTransaction.hash,
    block: Number(receipt.blockNumber),
  };
}

async function main(): Promise<void> {
  const network = hre.network.name;
  if (network === "hskMainnet") assertMainnetConfirmed(`network "${network}"`);

  const publicClient = await hre.viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  if (chainId === HSK_MAINNET_CHAIN_ID) assertMainnetConfirmed(`chain id ${chainId}`);

  const [deployer] = await hre.viem.getWalletClients();
  if (deployer === undefined) {
    throw new Error(
      `No deployer account for network "${network}". Set DEPLOYER_PRIVATE_KEY (see contracts/.env.example).`,
    );
  }
  const deployerAddress = getAddress(deployer.account.address);
  const balance = await publicClient.getBalance({ address: deployerAddress });
  console.log(`Deploying to ${network} (chain ${chainId}) from ${deployerAddress}, balance ${formatEther(balance)}`);
  if (balance === 0n) throw new Error(`Deployer ${deployerAddress} has no native balance to pay for gas.`);

  const nodReceipts = await confirmDeployment("NodReceipts", hre.viem.sendDeploymentTransaction("NodReceipts"));
  const nodPolicy = await confirmDeployment("NodPolicy", hre.viem.sendDeploymentTransaction("NodPolicy"));

  const record = {
    network,
    chainId,
    deployer: deployerAddress,
    NodReceipts: nodReceipts,
    NodPolicy: nodPolicy,
    deployedAt: new Date().toISOString(),
  };
  const dir = path.join(__dirname, "..", "deployments");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${network}.json`);
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`\nWrote ${path.relative(process.cwd(), file)}`);

  const explorer = EXPLORERS[chainId];
  for (const [name, deployed] of [
    ["NodReceipts", nodReceipts],
    ["NodPolicy", nodPolicy],
  ] as const) {
    console.log(`${name}: ${deployed.address} (block ${deployed.block})`);
    if (explorer !== undefined) {
      console.log(`  address: ${explorer}/address/${deployed.address}`);
      console.log(`  tx:      ${explorer}/tx/${deployed.txHash}`);
    }
  }
  if (network === "hskTestnet" || network === "hskMainnet") {
    console.log(`\nVerify on Blockscout:`);
    console.log(`  npx hardhat verify --network ${network} ${nodReceipts.address}`);
    console.log(`  npx hardhat verify --network ${network} ${nodPolicy.address}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
