// Gasless TradeTrust document mint via EIP-7702 + permissionless (EntryPoint v0.8).
//
// Flow:
//   1. EOA is delegated (type-4 tx) to permissionless impl if not already
//   2. UserOp calls: execute(PAYMASTER, 0, mintDocument(registry, beneficiary, holder, tokenId, remark))
//   3. PlatformPaymaster sponsors gas when userWhitelist[sender] > 0
//   4. TitleEscrow address is extracted from TitleEscrowLinked event
//
// Run: npx ts-node scripts/mintDocumentGasless.ts
//
// Required .env:
//   PIMLICO_API_KEY        — free at dashboard.pimlico.io
//   OWNER_PRIVATE_KEY      — whitelisted user's key (signs UserOps, needs no ETH)
//   PRIVATE_KEY            — funded wallet (pays gas for delegation tx if needed)
//   SEPOLIA_RPC_URL        — Sepolia RPC
//   PAYMASTER_ADDRESS      — deployed PlatformPaymaster (v0.8 EntryPoint)
//   REGISTRY_ADDRESS       — authorized TradeTrustToken registry to mint on
//   BENEFICIARY_ADDRESS    — address that becomes the beneficiary of the document
//   HOLDER_ADDRESS         — address that becomes the holder of the document
//   TOKEN_ID               — document token ID (uint256, e.g. a keccak256 doc hash)
//
// Optional .env:
//   REMARK                 — hex-encoded remark bytes (default: 0x)

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  toHex,
  parseAbi,
  decodeEventLog,
} from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createSmartAccountClient } from "permissionless";
import { to7702SimpleSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { entryPoint08Address } from "viem/account-abstraction";
import * as dotenv from "dotenv";
dotenv.config();

const PERMISSIONLESS_IMPL =
  "0xe6Cae83BdE06E4c305530e199D7217f42808555B" as const;

const paymasterAbi = parseAbi([
  "function mintDocument(address registry, address beneficiary, address holder, uint256 tokenId, bytes remark) external returns (address titleEscrow)",
  "event TitleEscrowLinked(address indexed titleEscrow, address indexed registry)",
]);

async function main() {
  if (!process.env.PIMLICO_API_KEY) throw new Error("PIMLICO_API_KEY not set");
  if (!process.env.OWNER_PRIVATE_KEY)
    throw new Error("OWNER_PRIVATE_KEY not set");
  if (!process.env.SEPOLIA_RPC_URL) throw new Error("SEPOLIA_RPC_URL not set");
  if (!process.env.PAYMASTER_ADDRESS)
    throw new Error("PAYMASTER_ADDRESS not set");
  if (!process.env.REGISTRY_ADDRESS)
    throw new Error("REGISTRY_ADDRESS not set");
  if (!process.env.BENEFICIARY_ADDRESS)
    throw new Error("BENEFICIARY_ADDRESS not set");
  if (!process.env.HOLDER_ADDRESS) throw new Error("HOLDER_ADDRESS not set");
  if (!process.env.TOKEN_ID) throw new Error("TOKEN_ID not set");

  const PAYMASTER_ADDR = process.env.PAYMASTER_ADDRESS as `0x${string}`;
  const registry = process.env.REGISTRY_ADDRESS as `0x${string}`;
  const beneficiary = process.env.BENEFICIARY_ADDRESS as `0x${string}`;
  const holder = process.env.HOLDER_ADDRESS as `0x${string}`;
  const tokenId = BigInt(process.env.TOKEN_ID);
  const rawRemark = process.env.REMARK ?? "";
  const remark: `0x${string}` = rawRemark
    ? rawRemark.startsWith("0x")
      ? (rawRemark as `0x${string}`)
      : toHex(rawRemark)
    : "0x";

  const PIMLICO_URL = `https://api.pimlico.io/v2/11155111/rpc?apikey=${process.env.PIMLICO_API_KEY}`;

  const ownerAccount = privateKeyToAccount(
    process.env.OWNER_PRIVATE_KEY as `0x${string}`,
  );
  const transport = http(process.env.SEPOLIA_RPC_URL);
  const publicClient = createPublicClient({ chain: sepolia, transport });

  console.log("Owner (whitelisted user) :", ownerAccount.address);
  console.log("Paymaster                :", PAYMASTER_ADDR);
  console.log("Permissionless impl      :", PERMISSIONLESS_IMPL);
  console.log("Registry                 :", registry);
  console.log("Beneficiary              :", beneficiary);
  console.log("Holder                   :", holder);
  console.log("Token ID                 :", tokenId.toString());
  console.log("Remark                   :", remark);
  console.log("");

  // Check delegation — must point to permissionless impl before submitting UserOp
  const code = await publicClient.getCode({ address: ownerAccount.address });
  const currentDelegate = code?.startsWith("0xef0100")
    ? (`0x${code.slice(8, 48)}` as `0x${string}`)
    : null;
  console.log("Current delegate :", currentDelegate ?? "none");

  if (currentDelegate?.toLowerCase() !== PERMISSIONLESS_IMPL.toLowerCase()) {
    if (!process.env.PRIVATE_KEY)
      throw new Error("PRIVATE_KEY needed for EIP-7702 delegation (pays gas)");

    const deployerAccount = privateKeyToAccount(
      process.env.PRIVATE_KEY as `0x${string}`,
    );
    const ownerWallet = createWalletClient({
      account: ownerAccount,
      chain: sepolia,
      transport,
    });
    const deployerWallet = createWalletClient({
      account: deployerAccount,
      chain: sepolia,
      transport,
    });

    console.log("Re-delegating EOA to permissionless impl...");
    const ownerNonce = await publicClient.getTransactionCount({
      address: ownerAccount.address,
    });
    const authorization = await ownerWallet.signAuthorization({
      contractAddress: PERMISSIONLESS_IMPL,
      nonce: ownerNonce,
    });
    const authTx = await deployerWallet.sendTransaction({
      to: ownerAccount.address,
      data: "0x",
      authorizationList: [authorization],
    });
    await publicClient.waitForTransactionReceipt({ hash: authTx });
    console.log("  Delegated tx:", authTx, "✓");
  } else {
    console.log("  Already delegated correctly — skipping");
  }
  console.log("");

  const account = await to7702SimpleSmartAccount({
    client: publicClient,
    owner: ownerAccount,
  });

  const pimlicoClient = createPimlicoClient({
    transport: http(PIMLICO_URL),
    entryPoint: { address: entryPoint08Address, version: "0.8" },
  });

  const smartAccountClient = createSmartAccountClient({
    account,
    chain: sepolia,
    bundlerTransport: http(PIMLICO_URL),
    paymaster: {
      async getPaymasterStubData() {
        return {
          paymaster: PAYMASTER_ADDR,
          paymasterData: "0x" as `0x${string}`,
          paymasterVerificationGasLimit: 200_000n,
          paymasterPostOpGasLimit: 100_000n,
          isFinal: false,
        };
      },
      async getPaymasterData() {
        return {
          paymaster: PAYMASTER_ADDR,
          paymasterData: "0x" as `0x${string}`,
          paymasterVerificationGasLimit: 200_000n,
          paymasterPostOpGasLimit: 100_000n,
        };
      },
    },
    userOperation: {
      estimateFeesPerGas: async () => {
        const { fast } = await pimlicoClient.getUserOperationGasPrice();
        return {
          maxFeePerGas: fast.maxFeePerGas,
          maxPriorityFeePerGas: fast.maxPriorityFeePerGas,
        };
      },
    },
  });

  const mintData = encodeFunctionData({
    abi: paymasterAbi,
    functionName: "mintDocument",
    args: [registry, beneficiary, holder, tokenId, remark],
  });

  console.log("Sending UserOp: mintDocument via PlatformPaymaster...");
  const txHash = await smartAccountClient.sendTransaction({
    to: PAYMASTER_ADDR,
    value: 0n,
    data: mintData,
  });

  const txReceipt = await publicClient.getTransactionReceipt({
    hash: txHash as `0x${string}`,
  });

  let titleEscrowAddress: string | undefined;
  for (const log of txReceipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: paymasterAbi,
        data: log.data,
        topics: log.topics,
        eventName: "TitleEscrowLinked",
      });
      titleEscrowAddress = decoded.args.titleEscrow as string;
      break;
    } catch {
      /* not this event */
    }
  }

  console.log("\n─────────────────────────────────────────────");
  console.log("Document minted gaslessly ✓");
  console.log("  tx           :", txHash);
  console.log("  Registry     :", registry);
  console.log("  Token ID     :", tokenId.toString());
  console.log("  Beneficiary  :", beneficiary);
  console.log("  Holder       :", holder);
  console.log(
    "  TitleEscrow  :",
    titleEscrowAddress ?? "(check TitleEscrowLinked event on tx)",
  );
  console.log("─────────────────────────────────────────────");
  console.log(
    "\nThe TitleEscrow is now in authorizedTitleEscrows on the paymaster.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
