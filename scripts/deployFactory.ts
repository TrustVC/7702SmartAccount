// Deploy PlatformAccountFactory.
// Run after deployImplementation.ts — the factory stores the implementation address
// and clones it cheaply for each platform via deployPlatformPaymaster().
//
// Run:
//   npx hardhat run scripts/deployFactory.ts --network sepolia
//   npx hardhat run scripts/deployFactory.ts --network amoy
//
// Required .env:
//   PRIVATE_KEY                         — deployer wallet (pays gas)
//   SEPOLIA_RPC_URL / AMOY_RPC_URL      — RPC for the target network
//   TDOC_DEPLOYER_ADDRESS_<NETWORK>     — deployed TDocDeployer contract
//   PAYMASTER_IMPLEMENTATION_<NETWORK>  — PlatformPaymaster implementation

import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import hre from "hardhat";
import * as dotenv from "dotenv";
import { getNetworkConfig, getEnv } from "./lib/network";
dotenv.config();

async function main() {
  if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY not set");

  const { chain, rpcUrl, suffix } = getNetworkConfig(hre.network.name);
  const tdocDeployer = getEnv(suffix, "TDOC_DEPLOYER_ADDRESS") as `0x${string}`;
  const paymasterImpl = getEnv(suffix, "PAYMASTER_IMPLEMENTATION") as `0x${string}`;

  const deployer = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account: deployer, chain, transport });

  const artifact = await hre.artifacts.readArtifact("PlatformAccountFactory");

  console.log("Network                 :", hre.network.name);
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
  console.log("  Network              :", hre.network.name);
  console.log("  Factory address      :", factoryAddress);
  console.log("  TDoc Deployer        :", tdocDeployer);
  console.log("  Paymaster impl       :", paymasterImpl);
  console.log("─────────────────────────────────────────────");
  console.log("\nNext steps:");
  console.log(`  Add to .env:  FACTORY_ADDRESS_${suffix}=${factoryAddress}`);
  console.log(`  Deploy a paymaster clone: npx hardhat run scripts/deployPlatformPaymaster.ts --network ${hre.network.name}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
