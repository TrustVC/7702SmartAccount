// Grant deployRegistry credits to a user on a PlatformPaymaster (max 3).
//
// Run:
//   npx hardhat run scripts/whitelistUser.ts --network sepolia
//   npx hardhat run scripts/whitelistUser.ts --network amoy
//
// Required .env:
//   PRIVATE_KEY                    — owner of the paymaster
//   SEPOLIA_RPC_URL / AMOY_RPC_URL — RPC for the target network
//   PAYMASTER_ADDRESS_<NETWORK>    — the PlatformPaymaster
//
// Optional .env:
//   WHITELIST_USER    — user EOA to whitelist (default: address of OWNER_PRIVATE_KEY)
//   WHITELIST_CREDITS — number of credits, 0-3 (default: 3)

import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import hre from "hardhat";
import * as dotenv from "dotenv";
import { getNetworkConfig, getEnv } from "./lib/network";
dotenv.config();

const paymasterAbi = parseAbi([
  "function setUserWhitelist(address user, uint256 credits) external",
  "function userWhitelist(address user) external view returns (uint256)",
]);

async function main() {
  if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY not set");

  const { chain, rpcUrl, suffix } = getNetworkConfig(hre.network.name);
  const paymasterAddress = getEnv(suffix, "PAYMASTER_ADDRESS") as `0x${string}`;

  let user = process.env.WHITELIST_USER as `0x${string}` | undefined;
  if (!user) {
    if (!process.env.OWNER_PRIVATE_KEY) throw new Error("Set WHITELIST_USER or OWNER_PRIVATE_KEY");
    user = privateKeyToAccount(process.env.OWNER_PRIVATE_KEY as `0x${string}`).address;
  }
  const credits = BigInt(process.env.WHITELIST_CREDITS ?? "3");

  const owner = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account: owner, chain, transport });

  console.log("Network   :", hre.network.name);
  console.log("Paymaster :", paymasterAddress);
  console.log("User      :", user);
  console.log("Credits   :", credits.toString());
  console.log("");

  const txHash = await walletClient.writeContract({
    address: paymasterAddress,
    abi: paymasterAbi,
    functionName: "setUserWhitelist",
    args: [user, credits],
  });
  console.log("  tx:", txHash);
  await publicClient.waitForTransactionReceipt({ hash: txHash });

  const now = await publicClient.readContract({
    address: paymasterAddress,
    abi: paymasterAbi,
    functionName: "userWhitelist",
    args: [user],
  });
  console.log(`\nUser whitelisted ✓ — credits: ${now}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
