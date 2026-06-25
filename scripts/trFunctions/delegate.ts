// Delegates OWNER_PRIVATE_KEY's EOA to the permissionless EIP-7702 impl.
// PRIVATE_KEY (paymaster deployer) submits the tx and pays gas.
//
// Run: npx ts-node scripts/trFunctions/delegate.ts
//
// Required .env:
//   OWNER_PRIVATE_KEY  — EOA to delegate (signs the authorization, pays no gas)
//   PRIVATE_KEY        — funded account that submits the tx and pays gas
//   SEPOLIA_RPC_URL

import { createPublicClient, createWalletClient, http } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import * as dotenv from "dotenv";
dotenv.config();

const PERMISSIONLESS_IMPL =
  "0xe6Cae83BdE06E4c305530e199D7217f42808555B" as const;

async function main() {
  if (!process.env.OWNER_PRIVATE_KEY)
    throw new Error("OWNER_PRIVATE_KEY not set");
  if (!process.env.PRIVATE_KEY)
    throw new Error("PRIVATE_KEY not set (gas payer)");
  if (!process.env.SEPOLIA_RPC_URL) throw new Error("SEPOLIA_RPC_URL not set");

  const ownerAccount = privateKeyToAccount(
    process.env.OWNER_PRIVATE_KEY as `0x${string}`,
  );
  const payerAccount = privateKeyToAccount(
    process.env.PRIVATE_KEY as `0x${string}`,
  );
  const transport = http(process.env.SEPOLIA_RPC_URL);
  const publicClient = createPublicClient({ chain: sepolia, transport });

  console.log("Owner EOA         :", ownerAccount.address);
  console.log("Gas payer         :", payerAccount.address);
  console.log("Target impl       :", PERMISSIONLESS_IMPL);
  console.log("");

  // Check current delegation
  const code = await publicClient.getCode({ address: ownerAccount.address });
  const currentDelegate = code?.startsWith("0xef0100")
    ? (`0x${code.slice(8, 48)}` as `0x${string}`)
    : null;

  console.log("Current delegate  :", currentDelegate ?? "none");

  if (currentDelegate?.toLowerCase() === PERMISSIONLESS_IMPL.toLowerCase()) {
    console.log("\nAlready delegated to permissionless impl ✓");
    return;
  }

  // Owner signs the EIP-7702 authorization (no gas required)
  const ownerWallet = createWalletClient({
    account: ownerAccount,
    chain: sepolia,
    transport,
  });
  const payerWallet = createWalletClient({
    account: payerAccount,
    chain: sepolia,
    transport,
  });

  const nonce = await publicClient.getTransactionCount({
    address: ownerAccount.address,
  });
  const authorization = await ownerWallet.signAuthorization({
    contractAddress: PERMISSIONLESS_IMPL,
    nonce,
  });

  console.log("Authorization signed by owner ✓");
  console.log(
    "Submitting delegation tx (gas paid by",
    payerAccount.address,
    ")...",
  );

  // Payer submits the type-4 tx with the signed authorization
  const txHash = await payerWallet.sendTransaction({
    to: ownerAccount.address,
    data: "0x",
    authorizationList: [authorization],
    gas: 100_000n,
  });

  console.log("tx:", txHash);
  await publicClient.waitForTransactionReceipt({ hash: txHash });

  // Confirm
  const newCode = await publicClient.getCode({ address: ownerAccount.address });
  const newDelegate = newCode?.startsWith("0xef0100")
    ? (`0x${newCode.slice(8, 48)}` as `0x${string}`)
    : null;

  console.log("\n─────────────────────────────────────────────");
  console.log("Delegation complete ✓");
  console.log("  Owner EOA  :", ownerAccount.address);
  console.log("  Delegated to:", newDelegate);
  console.log("─────────────────────────────────────────────");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
