// Stake and fund a deployed PlatformPaymaster on the EntryPoint v0.8.
//
// Two separate operations:
//   1. addStake  — locks ETH as a bundler-compliance bond (not used for gas)
//   2. deposit   — funds the gas pool that pays for sponsored UserOps
//
// Run:
//   npx hardhat run scripts/stakePlatformPaymaster.ts --network sepolia
//   npx hardhat run scripts/stakePlatformPaymaster.ts --network amoy
//
// Required .env:
//   PRIVATE_KEY                    — owner of the deployed paymaster
//   SEPOLIA_RPC_URL / AMOY_RPC_URL — RPC for the target network
//   PAYMASTER_ADDRESS_<NETWORK>    — the PlatformPaymaster to stake
//
// Optional .env:
//   STAKE_AMOUNT_ETH   — ETH to lock as stake        (default: 0.01)
//   DEPOSIT_AMOUNT_ETH — ETH to deposit for gas pool (default: 0.05)
//   UNSTAKE_DELAY_SEC  — lock period in seconds       (default: 86400 = 1 day)

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  parseAbi,
  formatEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import hre from "hardhat";
import * as dotenv from "dotenv";
import { getNetworkConfig, getEnv } from "./lib/network";
dotenv.config();

const ENTRY_POINT = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108" as `0x${string}`;

const paymasterAbi = parseAbi([
  "function addStake(uint32 unstakeDelaySec) external payable",
  "function deposit() external payable",
]);

const entryPointAbi = parseAbi([
  "function getDepositInfo(address account) external view returns (uint256 deposit, bool staked, uint112 stake, uint32 unstakeDelaySec, uint48 withdrawTime)",
]);

async function main() {
  if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY not set");

  const { chain, rpcUrl, suffix } = getNetworkConfig(hre.network.name);
  const paymasterAddress = getEnv(suffix, "PAYMASTER_ADDRESS") as `0x${string}`;
  const stakeEth = process.env.STAKE_AMOUNT_ETH ?? "0.01";
  const depositEth = process.env.DEPOSIT_AMOUNT_ETH ?? "0.05";
  const unstakeDelay = Number(process.env.UNSTAKE_DELAY_SEC ?? "86400");

  const owner = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account: owner, chain, transport });

  const infoRaw = await publicClient.readContract({
    address: ENTRY_POINT,
    abi: entryPointAbi,
    functionName: "getDepositInfo",
    args: [paymasterAddress],
  });
  const info = { deposit: infoRaw[0], staked: infoRaw[1], stake: infoRaw[2], unstakeDelaySec: infoRaw[3] };

  console.log("\n─────────────────────────────────────────────");
  console.log("Network          :", hre.network.name);
  console.log("Paymaster        :", paymasterAddress);
  console.log("EntryPoint       :", ENTRY_POINT);
  console.log("Currently staked :", info.staked);
  console.log("");

  if (info.staked) {
    console.log("Step 1 — Already staked, skipping.");
  } else {
    console.log(`Step 1 — Staking ${stakeEth} ETH (locked for ${unstakeDelay}s)...`);
    const stakeTx = await walletClient.writeContract({
      address: paymasterAddress,
      abi: paymasterAbi,
      functionName: "addStake",
      args: [unstakeDelay],
      value: parseEther(stakeEth),
    });
    console.log("  addStake() tx:", stakeTx);
    await publicClient.waitForTransactionReceipt({ hash: stakeTx });
    console.log("  Confirmed ✓");
  }

  console.log(`\nStep 2 — Depositing ${depositEth} ETH into gas pool...`);
  const depositTx = await walletClient.writeContract({
    address: paymasterAddress,
    abi: paymasterAbi,
    functionName: "deposit",
    value: parseEther(depositEth),
  });
  console.log("  deposit() tx:", depositTx);
  await publicClient.waitForTransactionReceipt({ hash: depositTx });
  console.log("  Confirmed ✓");

  const afterRaw = await publicClient.readContract({
    address: ENTRY_POINT,
    abi: entryPointAbi,
    functionName: "getDepositInfo",
    args: [paymasterAddress],
  });
  const after = { deposit: afterRaw[0], staked: afterRaw[1], stake: afterRaw[2], unstakeDelaySec: afterRaw[3] };

  console.log("\n─────────────────────────────────────────────");
  console.log("PlatformPaymaster staked and funded ✓");
  console.log("  Paymaster    :", paymasterAddress);
  console.log("  Staked       :", after.staked, "— stake:", formatEther(after.stake), "ETH");
  console.log("  Deposit      :", formatEther(after.deposit), "ETH");
  console.log("  Unstake delay:", after.unstakeDelaySec, "sec");
  console.log("─────────────────────────────────────────────");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
