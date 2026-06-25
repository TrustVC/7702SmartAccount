// transferHolder(address newHolder, bytes calldata _remark)
// Sends a UserOp through Pimlico to call transferHolder() on the TR contract.
//
// Run: npx hardhat run scripts/trFunctions/transferHolder.ts --network sepolia
//
// Required .env:
//   PIMLICO_API_KEY, OWNER_PRIVATE_KEY, SEPOLIA_RPC_URL
//   REGISTRY_ADDRESS  — address of the TR contract
//   NEW_HOLDER_ADDR   — address of the new holder
//   REMARK            — optional remark text (default: "")
//   PRIVATE_KEY       — only needed if EOA delegation is required

import { encodeFunctionData, parseAbi } from "viem";
import { buildClient, toRemarkBytes } from "./_setup";
import * as dotenv from "dotenv";
dotenv.config();

const abi = parseAbi([
  "function transferHolder(address newHolder, bytes calldata _remark) external",
]);

async function main() {
  if (!process.env.TITLE_ESCROW_ADDRESS)
    throw new Error("TITLE_ESCROW_ADDRESS not set");
  if (!process.env.NEW_HOLDER_ADDR) throw new Error("NEW_HOLDER_ADDR not set");

  const contract = process.env.TITLE_ESCROW_ADDRESS as `0x${string}`;
  const newHolder = process.env.NEW_HOLDER_ADDR as `0x${string}`;
  const remark = toRemarkBytes(process.env.REMARK ?? "");

  console.log("TR Contract :", contract);
  console.log("New Holder  :", newHolder);
  console.log("Remark      :", process.env.REMARK ?? "(empty)");
  console.log("");

  const { smartAccountClient, ownerAddress } = await buildClient();
  console.log("\nSending transferHolder() UserOp...");

  const txHash = await smartAccountClient.sendTransaction({
    to: contract,
    value: 0n,
    data: encodeFunctionData({
      abi,
      functionName: "transferHolder",
      args: [newHolder, remark],
    }),
  });

  console.log("txHash:", txHash);
  console.log(`\ntransferHolder() complete — owner: ${ownerAddress} ✓`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
