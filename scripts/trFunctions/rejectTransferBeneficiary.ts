// rejectTransferBeneficiary(bytes calldata _remark)
// Sends a UserOp through Pimlico to call rejectTransferBeneficiary() on the TR contract.
//
// Run: npx hardhat run scripts/trFunctions/rejectTransferBeneficiary.ts --network sepolia
//
// Required .env:
//   PIMLICO_API_KEY, OWNER_PRIVATE_KEY, SEPOLIA_RPC_URL
//   REGISTRY_ADDRESS — address of the TR contract
//   REMARK           — optional remark text (default: "")
//   PRIVATE_KEY      — only needed if EOA delegation is required

import { encodeFunctionData, parseAbi } from "viem";
import { buildClient, toRemarkBytes, getTRContract } from "./_setup";
import * as dotenv from "dotenv";
dotenv.config();

const abi = parseAbi([
  "function rejectTransferBeneficiary(bytes calldata _remark) external",
]);

async function main() {
  const remark = toRemarkBytes(process.env.REMARK ?? "");

  console.log("Remark      :", process.env.REMARK ?? "(empty)");
  console.log("");

  const { smartAccountClient, ownerAddress, suffix } = await buildClient();
  const contract = getTRContract(suffix);
  console.log("TR Contract :", contract);
  console.log("\nSending rejectTransferBeneficiary() UserOp...");

  const txHash = await smartAccountClient.sendTransaction({
    to: contract,
    value: 0n,
    data: encodeFunctionData({
      abi,
      functionName: "rejectTransferBeneficiary",
      args: [remark],
    }),
  });

  console.log("txHash:", txHash);
  console.log(
    `\nrejectTransferBeneficiary() complete — owner: ${ownerAddress} ✓`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
