// nominate(address _nominee, bytes calldata _remark)
// Sends a UserOp through Pimlico to call nominate() on the TR contract.
//
// Run: npx hardhat run scripts/trFunctions/nominate.ts --network sepolia
//
// Required .env:
//   PIMLICO_API_KEY, OWNER_PRIVATE_KEY, SEPOLIA_RPC_URL
//   REGISTRY_ADDRESS — address of the TR contract
//   NOMINEE_ADDR     — address to nominate
//   REMARK           — optional remark text (default: "")
//   PRIVATE_KEY      — only needed if EOA delegation is required

import { encodeFunctionData, parseAbi } from "viem";
import { buildClient, toRemarkBytes, getTRContract } from "./_setup";
import * as dotenv from "dotenv";
dotenv.config();

const abi = parseAbi([
  "function nominate(address _nominee, bytes calldata _remark) external",
]);

async function main() {
  const contract = getTRContract();
  const nominee = process.env.NOMINEE_ADDR as `0x${string}`;
  const remark = toRemarkBytes(process.env.REMARK ?? "");

  if (!nominee) throw new Error("NOMINEE_ADDR not set");

  console.log("TR Contract :", contract);
  console.log("Nominee     :", nominee);
  console.log("Remark      :", process.env.REMARK ?? "(empty)");
  console.log("");

  const { smartAccountClient, ownerAddress } = await buildClient();
  console.log("\nSending nominate() UserOp...");

  const txHash = await smartAccountClient.sendTransaction({
    to: contract,
    value: 0n,
    data: encodeFunctionData({
      abi,
      functionName: "nominate",
      args: [nominee, remark],
    }),
  });

  console.log("txHash:", txHash);
  console.log(`\nnominate() complete — owner: ${ownerAddress} ✓`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
