// Deploy the PlatformPaymaster implementation contract (run once per chain).
// All future platform paymasters are cheap clones of this implementation.
//
// Run:
//   npx hardhat run scripts/deployImplementation.ts --network sepolia
//   npx hardhat run scripts/deployImplementation.ts --network amoy
//
// Required .env:
//   PRIVATE_KEY                    — deployer wallet (pays gas)
//   SEPOLIA_RPC_URL / AMOY_RPC_URL — RPC for the target network
//
// Optional .env:
//   ENTRY_POINT — EntryPoint v0.8 address
//                 (default: 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108)

import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import hre from "hardhat";
import * as dotenv from "dotenv";
import { getNetworkConfig, getFeeOverrides } from "./lib/network";
dotenv.config();

const DEFAULT_ENTRY_POINT = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108" as `0x${string}`;

async function main() {
  if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY not set");

  const { chain, rpcUrl, suffix } = getNetworkConfig(hre.network.name);
  const entryPoint = (process.env.ENTRY_POINT ?? DEFAULT_ENTRY_POINT) as `0x${string}`;

  const deployer = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account: deployer, chain, transport });

  const artifact = await hre.artifacts.readArtifact("PlatformPaymaster");

  console.log("Network    :", hre.network.name);
  console.log("Deployer   :", deployer.address);
  console.log("EntryPoint :", entryPoint);
  console.log("");
  console.log("Deploying PlatformPaymaster implementation...");

  const txHash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode as `0x${string}`,
    args: [entryPoint],
    ...getFeeOverrides(hre.network.name),
  });
  console.log("  tx:", txHash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const implAddress = receipt.contractAddress;
  if (!implAddress) throw new Error("Deploy failed — no contract address in receipt");

  console.log("\n─────────────────────────────────────────────");
  console.log("PlatformPaymaster implementation deployed ✓");
  console.log("  Network    :", hre.network.name);
  console.log("  Address    :", implAddress);
  console.log("  EntryPoint :", entryPoint);
  console.log("─────────────────────────────────────────────");
  console.log("\nNext step:");
  console.log(`  Add to .env:  PAYMASTER_IMPLEMENTATION_${suffix}=${implAddress}`);
  console.log(`  Then run:     npx hardhat run scripts/deployFactory.ts --network ${hre.network.name}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
