// Show a user's daily sponsored spend, and optionally update the paymaster's dailyLimit.
// dailyLimit is global — it applies to every user of this paymaster.
//
// Run:
//   npx hardhat run scripts/dailyLimit.ts --network sepolia
//
// Required .env:
//   SEPOLIA_RPC_URL / AMOY_RPC_URL — RPC for the target network
//   PAYMASTER_ADDRESS_<NETWORK>    — the PlatformPaymaster
//
// Optional .env:
//   DAILY_SPEND_USER     — user to inspect (default: address of OWNER_PRIVATE_KEY)
//   NEW_DAILY_LIMIT_WEI  — if set, calls setDailyLimit with this value (needs PRIVATE_KEY = paymaster owner)

import { createPublicClient, createWalletClient, formatEther, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import hre from "hardhat";
import * as dotenv from "dotenv";
import { getNetworkConfig, getEnv } from "./lib/network";
dotenv.config();

const paymasterAbi = parseAbi([
  "function getUserDailySpend(address user) external view returns (uint256 spent, uint256 limit, uint256 resetsAt)",
  "function setDailyLimit(uint256 _dailyLimit) external",
]);

async function main() {
  const { chain, rpcUrl, suffix } = getNetworkConfig(hre.network.name);
  const paymasterAddress = getEnv(suffix, "PAYMASTER_ADDRESS") as `0x${string}`;

  let user = process.env.DAILY_SPEND_USER as `0x${string}` | undefined;
  if (!user) {
    if (!process.env.OWNER_PRIVATE_KEY) throw new Error("Set DAILY_SPEND_USER or OWNER_PRIVATE_KEY");
    user = privateKeyToAccount(process.env.OWNER_PRIVATE_KEY as `0x${string}`).address;
  }

  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain, transport });

  const show = async (label: string) => {
    const [spent, limit, resetsAt] = await publicClient.readContract({
      address: paymasterAddress,
      abi: paymasterAbi,
      functionName: "getUserDailySpend",
      args: [user],
    });
    console.log(`\n${label}`);
    console.log("  User      :", user);
    console.log("  Spent     :", formatEther(spent), `ETH (${spent} wei)`);
    console.log("  Limit     :", formatEther(limit), `ETH (${limit} wei)`, limit === 0n ? "— unlimited" : "");
    console.log("  Resets at :", resetsAt === 86400n ? "— (no spend yet)" : new Date(Number(resetsAt) * 1000).toISOString());
  };

  console.log("Network   :", hre.network.name);
  console.log("Paymaster :", paymasterAddress);
  await show("Current");

  const newLimit = process.env.NEW_DAILY_LIMIT_WEI;
  if (!newLimit) return;

  if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY (paymaster owner) not set");
  const owner = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
  const walletClient = createWalletClient({ account: owner, chain, transport });

  console.log(`\nSetting dailyLimit to ${formatEther(BigInt(newLimit))} ETH...`);
  const txHash = await walletClient.writeContract({
    address: paymasterAddress,
    abi: paymasterAbi,
    functionName: "setDailyLimit",
    args: [BigInt(newLimit)],
  });
  console.log("  tx:", txHash);
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  await show("Updated");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
