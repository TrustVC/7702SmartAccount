// Deploy PlatformAccountFactory.
// Run after deployImplementation.ts — the factory stores the implementation address
// and clones it cheaply for each platform via deployPlatformPaymaster().
//
// Run: npx hardhat run scripts/deployFactory.ts --network sepolia
//
// Required .env:
//   PRIVATE_KEY                — deployer wallet (pays gas)
//   SEPOLIA_RPC_URL            — Sepolia RPC
//   TDOC_DEPLOYER_ADDRESS      — deployed TDocDeployer contract
//   PAYMASTER_IMPLEMENTATION   — PlatformPaymaster implementation from deployImplementation.ts

import { createPublicClient, createWalletClient, http } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import hre from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY not set");
  if (!process.env.SEPOLIA_RPC_URL) throw new Error("SEPOLIA_RPC_URL not set");
  if (!process.env.TDOC_DEPLOYER_ADDRESS)
    throw new Error("TDOC_DEPLOYER_ADDRESS not set");
  if (!process.env.PAYMASTER_IMPLEMENTATION)
    throw new Error("PAYMASTER_IMPLEMENTATION not set — run deployImplementation.ts first");

  const tdocDeployer = process.env.TDOC_DEPLOYER_ADDRESS.trim() as `0x${string}`;
  const paymasterImpl = process.env.PAYMASTER_IMPLEMENTATION.trim() as `0x${string}`;

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

  const artifact = await hre.artifacts.readArtifact("PlatformAccountFactory");

  console.log("Deployer                :", deployer.address);
  console.log("TDoc Deployer           :", tdocDeployer);
  console.log("Paymaster Implementation:", paymasterImpl);
  console.log("");
  console.log("Deploying PlatformAccountFactory...");

  const txHash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode as `0x${string}`,
    args: [tdocDeployer, paymasterImpl],
  });
  console.log("  tx:", txHash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const factoryAddress = receipt.contractAddress;
  if (!factoryAddress) throw new Error("Deploy failed — no contract address in receipt");

  console.log("\n─────────────────────────────────────────────");
  console.log("PlatformAccountFactory deployed ✓");
  console.log("  Factory address      :", factoryAddress);
  console.log("  TDoc Deployer        :", tdocDeployer);
  console.log("  Paymaster impl       :", paymasterImpl);
  console.log("─────────────────────────────────────────────");
  console.log("\nNext steps:");
  console.log("  Add to .env:  FACTORY_ADDRESS=" + factoryAddress);
  console.log("  Deploy a paymaster clone: npx hardhat run scripts/deployPlatformPaymaster.ts --network sepolia");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
