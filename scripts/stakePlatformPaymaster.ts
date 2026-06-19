// Stake and fund a deployed PlatformPaymaster on the Pimlico EntryPoint v0.7.
//
// Two separate operations:
//   1. addStake  — locks ETH as a bundler-compliance bond (not used for gas)
//   2. deposit   — funds the gas pool that pays for sponsored UserOps
//
// Run: npx hardhat run scripts/stakePlatformPaymaster.ts --network sepolia
//
// Required .env:
//   PRIVATE_KEY          — owner of the deployed paymaster
//   SEPOLIA_RPC_URL      — Sepolia RPC
//   PAYMASTER_ADDRESS    — the PlatformPaymaster to stake
//
// Optional .env:
//   STAKE_AMOUNT_ETH     — ETH to lock as stake        (default: 0.01)
//   DEPOSIT_AMOUNT_ETH   — ETH to deposit for gas pool (default: 0.05)
//   UNSTAKE_DELAY_SEC    — lock period in seconds       (default: 86400 = 1 day)

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  parseAbi,
  formatEther,
} from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import * as dotenv from "dotenv";
dotenv.config();

// Canonical EntryPoint v0.7 — used by Pimlico
const ENTRY_POINT =
  "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as `0x${string}`;

const paymasterAbi = parseAbi([
  "function addStake(uint32 unstakeDelaySec) external payable",
  "function deposit() external payable",
]);

const entryPointAbi = parseAbi([
  "function getDepositInfo(address account) external view returns (uint256 deposit, bool staked, uint112 stake, uint32 unstakeDelaySec, uint48 withdrawTime)",
]);

async function main() {
  if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY not set");
  if (!process.env.SEPOLIA_RPC_URL) throw new Error("SEPOLIA_RPC_URL not set");
  if (!process.env.PAYMASTER_ADDRESS)
    throw new Error("PAYMASTER_ADDRESS not set");

  const paymasterAddress = process.env.PAYMASTER_ADDRESS as `0x${string}`;
  const stakeEth = process.env.STAKE_AMOUNT_ETH ?? "0.01";
  const depositEth = process.env.DEPOSIT_AMOUNT_ETH ?? "0.05";
  const unstakeDelay = Number(process.env.UNSTAKE_DELAY_SEC ?? "86400");

  const owner = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
  const transport = http(process.env.SEPOLIA_RPC_URL);
  const publicClient = createPublicClient({ chain: sepolia, transport });
  const walletClient = createWalletClient({
    account: owner,
    chain: sepolia,
    transport,
  });

  // ── Current status ───────────────────────────────────────────────────────────
  const info = (await publicClient.readContract({
    address: ENTRY_POINT,
    abi: entryPointAbi,
    functionName: "getDepositInfo",
    args: [paymasterAddress],
  })) as {
    deposit: bigint;
    staked: boolean;
    stake: bigint;
    unstakeDelaySec: number;
  };
  console.log("\n─────────────────────────────────────────────");
  console.log("PlatformPaymaster status:", info);
  console.log("Paymaster        :", paymasterAddress);
  console.log("EntryPoint       :", ENTRY_POINT);
  // console.log("Current deposit  :", formatEther(info.deposit), "ETH");
  console.log("Currently staked :", info.staked);
  // console.log("Current stake    :", formatEther(info.stake), "ETH");
  console.log("");

  // ── Step 1: Stake ────────────────────────────────────────────────────────────
  if (info.staked) {
    console.log("Step 1 — Already staked, skipping.");
  } else {
    console.log(
      `Step 1 — Staking ${stakeEth} ETH (locked for ${unstakeDelay}s)...`,
    );
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

  // ── Step 2: Deposit gas funds ────────────────────────────────────────────────
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

  // ── Final status ─────────────────────────────────────────────────────────────
  const after = (await publicClient.readContract({
    address: ENTRY_POINT,
    abi: entryPointAbi,
    functionName: "getDepositInfo",
    args: [paymasterAddress],
  })) as {
    deposit: bigint;
    staked: boolean;
    stake: bigint;
    unstakeDelaySec: number;
  };

  console.log("\n─────────────────────────────────────────────");
  console.log("PlatformPaymaster staked and funded ✓");
  console.log("  Paymaster    :", paymasterAddress);
  console.log(
    "  Staked       :",
    after.staked,
    "— stake:",
    formatEther(after.stake),
    "ETH",
  );
  console.log("  Deposit      :", formatEther(after.deposit), "ETH");
  console.log("  Unstake delay:", after.unstakeDelaySec, "sec");
  console.log("─────────────────────────────────────────────");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
