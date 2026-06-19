// Stake the owner EOA on Etherspot EP9 so the bundler accepts EIP-7702 UserOps.
//
// Why: Etherspot's bundler requires EIP-7702 sender accounts to be staked
// because their delegation code can change — treated like a factory entity
// under ERC-7562 validation rules. Without stake the op is rejected with
// "sender is unstaked" (-32505).
//
// Run: npx hardhat run scripts/stakeOwnerOnEP9.ts --network sepolia
//
// Required .env:
//   PRIVATE_KEY        — funded wallet (pays for the stake ETH)
//   OWNER_PRIVATE_KEY  — the EIP-7702 sender that needs to be staked
//   SEPOLIA_RPC_URL    — Sepolia RPC
//
// Optional .env:
//   STAKE_AMOUNT_ETH   — ETH to lock as stake (default: 0.01)
//   UNSTAKE_DELAY_SEC  — lock period in seconds (default: 86400 = 1 day)

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

const ETHERSPOT_ENTRY_POINT =
  "0x433709009B8330FDa32311DF1C2AFA402eD8D009" as `0x${string}`;

const entryPointAbi = parseAbi([
  "function addStake(uint32 unstakeDelaySec) external payable",
  // returns tuple: [deposit, staked, stake, unstakeDelaySec, withdrawTime]
  "function getDepositInfo(address account) external view returns (uint256, bool, uint112, uint32, uint48)",
]);

async function main() {
  if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY not set");
  if (!process.env.OWNER_PRIVATE_KEY)
    throw new Error("OWNER_PRIVATE_KEY not set");
  if (!process.env.SEPOLIA_RPC_URL) throw new Error("SEPOLIA_RPC_URL not set");

  const stakeEth = process.env.STAKE_AMOUNT_ETH ?? "0.01";
  const unstakeDelay = Number(process.env.UNSTAKE_DELAY_SEC ?? "86400");

  const ownerAccount = privateKeyToAccount(
    process.env.OWNER_PRIVATE_KEY as `0x${string}`,
  );
  const fundedAccount = privateKeyToAccount(
    process.env.PRIVATE_KEY as `0x${string}`,
  );

  const transport = http(process.env.SEPOLIA_RPC_URL);
  const publicClient = createPublicClient({ chain: sepolia, transport });

  // ── Current state ─────────────────────────────────────────────────────────
  // returns [deposit, staked, stake, unstakeDelaySec, withdrawTime]
  const [rawInfo, ownerBalance] = await Promise.all([
    publicClient.readContract({
      address: ETHERSPOT_ENTRY_POINT,
      abi: entryPointAbi,
      functionName: "getDepositInfo",
      args: [ownerAccount.address],
    }) as Promise<readonly [bigint, boolean, bigint, number, number]>,
    publicClient.getBalance({ address: ownerAccount.address }),
  ]);

  const [deposit, staked, stake, unstakeDelaySec] = rawInfo;

  console.log("Owner EOA   :", ownerAccount.address);
  console.log("ETH balance :", formatEther(ownerBalance), "ETH");
  console.log("EP9 deposit :", formatEther(deposit), "ETH");
  console.log("Staked      :", staked);
  console.log("Stake       :", formatEther(stake), "ETH");
  console.log("Delay       :", unstakeDelaySec, "sec");
  console.log("");

  if (staked) {
    console.log("Owner is already staked on EP9 — nothing to do.");
    return;
  }

  const stakeWei = parseEther(stakeEth);

  // ── Fund owner if needed ──────────────────────────────────────────────────
  // addStake must be called BY the entity (owner EOA) with ETH attached.
  // If owner has no ETH, send from the funded deployer wallet first.
  if (ownerBalance < stakeWei) {
    const topUp = stakeWei - ownerBalance + parseEther("0.002"); // +buffer for gas
    console.log(`Owner needs ETH. Sending ${formatEther(topUp)} ETH from funded wallet...`);
    const fundedWallet = createWalletClient({
      account: fundedAccount,
      chain: sepolia,
      transport,
    });
    const fundTx = await fundedWallet.sendTransaction({
      to: ownerAccount.address,
      value: topUp,
    });
    await publicClient.waitForTransactionReceipt({ hash: fundTx });
    console.log("  Funded tx:", fundTx, "✓\n");
  }

  // ── addStake from owner EOA ────────────────────────────────────────────────
  // The stake MUST come from the entity being staked (msg.sender = owner EOA).
  const ownerWallet = createWalletClient({
    account: ownerAccount,
    chain: sepolia,
    transport,
  });

  console.log(`Staking ${stakeEth} ETH on EP9 with ${unstakeDelay}s delay...`);
  const stakeTx = await ownerWallet.writeContract({
    address: ETHERSPOT_ENTRY_POINT,
    abi: entryPointAbi,
    functionName: "addStake",
    args: [unstakeDelay],
    value: stakeWei,
  });
  console.log("  addStake() tx:", stakeTx);
  await publicClient.waitForTransactionReceipt({ hash: stakeTx });
  console.log("  Confirmed ✓\n");

  // ── Verify ────────────────────────────────────────────────────────────────
  const afterRaw = await publicClient.readContract({
    address: ETHERSPOT_ENTRY_POINT,
    abi: entryPointAbi,
    functionName: "getDepositInfo",
    args: [ownerAccount.address],
  }) as readonly [bigint, boolean, bigint, number, number];

  const [, afterStaked, afterStake, afterDelay] = afterRaw;

  console.log("After staking:");
  console.log("  staked :", afterStaked);
  console.log("  stake  :", formatEther(afterStake), "ETH");
  console.log("  delay  :", afterDelay, "sec");

  if (afterStaked) {
    console.log("\nOwner EOA staked on EP9 — ready to send UserOps.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
