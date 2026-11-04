// transferHolder(address newHolder, bytes calldata _remark)
// Sends a UserOp through Pimlico to call transferHolder() on the TR contract.
//
// Run: npx hardhat run scripts/trFunctions/transferHolder.ts --network sepolia
//
// Required .env:
//   NETWORK           — sepolia | amoy  (default: sepolia)
//   PIMLICO_API_KEY, OWNER_PRIVATE_KEY, SEPOLIA_RPC_URL / AMOY_RPC_URL
//   TITLE_ESCROW_ADDRESS_<NETWORK> — address of the TR contract
//   NEW_HOLDER_ADDR   — address of the new holder
//   REMARK            — optional remark text (default: "")
//   PRIVATE_KEY       — only needed if EOA delegation is required

import { encodeFunctionData, parseAbi } from "viem";
import { buildClient, toRemarkBytes, getTRContract } from "./_setup";
import { sendSponsoredTransaction } from "../lib/userOp";
import * as dotenv from "dotenv";
dotenv.config();

const abi = parseAbi([
  "function transferHolder(address newHolder, bytes calldata _remark) external",
]);

async function main() {
  if (!process.env.NEW_HOLDER_ADDR) throw new Error("NEW_HOLDER_ADDR not set");

  const newHolder = process.env.NEW_HOLDER_ADDR as `0x${string}`;
  const remark = toRemarkBytes(process.env.REMARK ?? "");

  console.log("New Holder  :", newHolder);
  console.log("Remark      :", process.env.REMARK ?? "(empty)");
  console.log("");

  const { smartAccountClient, ownerAddress, suffix } = await buildClient();
  const contract = getTRContract(suffix);
  console.log("TR Contract :", contract);
  console.log("\nSending transferHolder() UserOp...");

  const txHash = await sendSponsoredTransaction(smartAccountClient, {
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
