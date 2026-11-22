import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

import "@nomicfoundation/hardhat-toolbox-viem";
import type { HardhatUserConfig } from "hardhat/config";

/**
 * Loads contracts/.env (if present) without overriding variables already set in the shell.
 * CONFIRM_MAINNET is deliberately ignored here: it has to be set in the shell for the one
 * mainnet deploy, so it can never be left switched on in a file.
 */
function loadDotEnv(file: string): void {
  if (!existsSync(file)) return;
  const parsed = parseEnv(readFileSync(file, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "CONFIRM_MAINNET" || value === undefined || process.env[key] !== undefined) continue;
    process.env[key] = value;
  }
}

loadDotEnv(path.join(__dirname, ".env"));

// Live networks get the deployer key only when it is set. Keys are never stored in this repo.
const deployerKey = process.env.DEPLOYER_PRIVATE_KEY?.trim();
const accounts = deployerKey ? [deployerKey.startsWith("0x") ? deployerKey : `0x${deployerKey}`] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // HSK Chain mainnet/testnet and Sepolia all support Cancun opcodes (PUSH0, MCOPY, TSTORE).
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {},
    hskTestnet: {
      url: "https://testnet.hsk.xyz",
      chainId: 133,
      accounts,
    },
    hskMainnet: {
      url: "https://mainnet.hsk.xyz",
      chainId: 177,
      accounts,
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
      chainId: 11155111,
      accounts,
    },
  },
  // `hardhat verify --network hskTestnet|hskMainnet <address>` goes to Blockscout's
  // Etherscan-compatible API. Blockscout ignores the API key, but hardhat-verify needs one,
  // and per-network keys are what make it use these custom URLs (a single string key
  // switches hardhat-verify to the Etherscan v2 endpoint).
  etherscan: {
    apiKey: {
      hskMainnet: "blockscout",
      hskTestnet: "blockscout",
    },
    customChains: [
      {
        network: "hskMainnet",
        chainId: 177,
        urls: {
          apiURL: "https://hsk.blockscout.com/api",
          browserURL: "https://hsk.blockscout.com",
        },
      },
      {
        network: "hskTestnet",
        chainId: 133,
        urls: {
          apiURL: "https://testnet-explorer.hskchain.net/api",
          browserURL: "https://testnet-explorer.hskchain.net",
        },
      },
    ],
  },
  sourcify: {
    enabled: false,
  },
};

export default config;
