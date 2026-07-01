// Deploy a PlatformPaymaster clone through PlatformAccountFactory.
// Each clone is a cheap minimal proxy sharing the implementation's logic.
// Prerequisites: deployImplementation.ts → deployFactory.ts must have been run first.
//
// Run:
//   npx hardhat run scripts/deployPlatformPaymaster.ts --network sepolia
//   npx hardhat run scripts/deployPlatformPaymaster.ts --network amoy
//
// Required .env:
//   PRIVATE_KEY                    — deployer wallet (pays gas)
//   SEPOLIA_RPC_URL / AMOY_RPC_URL — RPC for the target network
//   FACTORY_ADDRESS_<NETWORK>      — deployed PlatformAccountFactory
//
// Optional .env:
//   PLATFORM_ADDRESS  — paymaster owner EOA (defaults to deployer)
//   DAILY_LIMIT_ETH   — per-user daily gas limit in ETH (default: 0 = unlimited)
//   DEPLOY_SALT       — hex bytes32 salt for CREATE2 (default: random)

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  parseAbi,
  parseEventLogs,
} from "viem";
import { randomBytes } from "crypto";
import { privateKeyToAccount } from "viem/accounts";
import hre from "hardhat";
import * as dotenv from "dotenv";
import { getNetworkConfig, getEnv } from "./lib/network";
dotenv.config();

const factoryAbi = parseAbi([
  "function deployPlatformPaymaster(address platformAddress, uint256 dailyLimit, bytes32 salt) external returns (address paymaster)",
  "event PlatformOnboarded(address indexed platformAddress, address indexed paymaster)",
]);

async function main() {
  if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY not set");

  const { chain, rpcUrl, suffix } = getNetworkConfig(hre.network.name);
  const factoryAddress = getEnv(suffix, "FACTORY_ADDRESS") as `0x${string}`;

  const deployer = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account: deployer, chain, transport });

  const platformAddress = (process.env.PLATFORM_ADDRESS ?? deployer.address) as `0x${string}`;
  const dailyLimit = parseEther(process.env.DAILY_LIMIT_ETH ?? "0");
  const salt = (process.env.DEPLOY_SALT ?? `0x${randomBytes(32).toString("hex")}`) as `0x${string}`;

  console.log("Network         :", hre.network.name);
  console.log("Factory         :", factoryAddress);
  console.log("Platform owner  :", platformAddress);
  console.log("Daily limit     :", process.env.DAILY_LIMIT_ETH ?? "0", "ETH (0 = unlimited)");
  console.log("Salt            :", salt);
  console.log("");

  console.log("Deploying PlatformPaymaster via factory...");
  const txHash = await walletClient.writeContract({
    address: factoryAddress,
    abi: factoryAbi,
    functionName: "deployPlatformPaymaster",
    args: [platformAddress, dailyLimit, salt],
  });
  console.log("  tx:", txHash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const logs = parseEventLogs({ abi: factoryAbi, logs: receipt.logs, eventName: "PlatformOnboarded" });
  const paymasterAddress = logs[0]?.args?.paymaster;
  if (!paymasterAddress) throw new Error("Deploy failed — no paymaster address in logs");

  console.log("\n─────────────────────────────────────────────");
  console.log("PlatformPaymaster deployed ✓");
  console.log("  Network        :", hre.network.name);
  console.log("  Address        :", paymasterAddress);
  console.log("  Factory        :", factoryAddress);
  console.log("  Platform owner :", platformAddress);
  console.log("─────────────────────────────────────────────");
  console.log("\nNext steps:");
  console.log(`  Add to .env:  PAYMASTER_ADDRESS_${suffix}=${paymasterAddress}`);
  console.log(`  Fund & stake: npx hardhat run scripts/stakePlatformPaymaster.ts --network ${hre.network.name}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
