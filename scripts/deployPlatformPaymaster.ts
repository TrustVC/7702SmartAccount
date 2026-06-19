// Deploy PlatformPaymaster through PlatformAccountFactory
//
// Run: npx hardhat run scripts/deployPlatformPaymaster.ts --network sepolia
//
// Required .env:
//   PRIVATE_KEY       — deployer wallet (pays gas)
//   SEPOLIA_RPC_URL   — Sepolia RPC
//
// Optional .env:
//   FACTORY_ADDRESS   — defaults to the deployed factory below
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
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import * as dotenv from "dotenv";
dotenv.config();

const FACTORY_ADDRESS =
  (process.env.FACTORY_ADDRESS as `0x${string}`) ??
  "0x9FCe71d971965EE345617B4bFC17305beA8e6C4b";

const factoryAbi = parseAbi([
  "function deployPlatformPaymaster(address platformAddress, uint256 dailyLimit, bytes32 salt) external returns (address paymaster)",
  "event PlatformOnboarded(address indexed platformAddress, address indexed paymaster)",
]);

async function main() {
  if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY not set");
  if (!process.env.SEPOLIA_RPC_URL) throw new Error("SEPOLIA_RPC_URL not set");

  const deployer = privateKeyToAccount(
    process.env.PRIVATE_KEY as `0x${string}`,
  );
  const transport = http(process.env.SEPOLIA_RPC_URL);
  const publicClient = createPublicClient({ chain: sepolia, transport });
  const walletClient = createWalletClient({
    account: deployer,
    chain: sepolia,
    transport,
  });

  const platformAddress = (process.env.PLATFORM_ADDRESS ??
    deployer.address) as `0x${string}`;
  const dailyLimit = parseEther(process.env.DAILY_LIMIT_ETH ?? "0");
  const salt = (process.env.DEPLOY_SALT ??
    `0x${randomBytes(32).toString("hex")}`) as `0x${string}`;

  console.log("Factory         :", FACTORY_ADDRESS);
  console.log("Platform owner  :", platformAddress);
  console.log(
    "Daily limit     :",
    process.env.DAILY_LIMIT_ETH ?? "0",
    "ETH (0 = unlimited)",
  );
  console.log("Salt            :", salt);
  console.log("");

  console.log("Deploying PlatformPaymaster via factory...");
  const txHash = await walletClient.writeContract({
    address: FACTORY_ADDRESS,
    abi: factoryAbi,
    functionName: "deployPlatformPaymaster",
    args: [platformAddress, dailyLimit, salt],
  });
  console.log("  tx:", txHash);

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });

  const logs = parseEventLogs({
    abi: factoryAbi,
    logs: receipt.logs,
    eventName: "PlatformOnboarded",
  });

  const paymasterAddress = logs[0]?.args?.paymaster;
  if (!paymasterAddress)
    throw new Error("Deploy failed — no paymaster address in logs");

  console.log("\n─────────────────────────────────────────────");
  console.log("PlatformPaymaster deployed ✓");
  console.log("  Address        :", paymasterAddress);
  console.log("  Factory        :", FACTORY_ADDRESS);
  console.log("  Platform owner :", platformAddress);
  console.log("─────────────────────────────────────────────");
  console.log("\nNext steps:");
  console.log("  1. Fund paymaster: send ETH to", paymasterAddress);
  console.log("  2. Set TDoc deployer: paymaster.setTdocDeployer(tdocAddress)");
  console.log("  3. Add registries:   paymaster.addRegistry(registryAddress)");
  console.log(
    "  4. Whitelist users:  paymaster.setUserWhitelist(user, credits)",
  );
  console.log("  5. Stake paymaster on EntryPoint for bundler compliance");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
