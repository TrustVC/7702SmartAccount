// Gasless TDoc registry deployment via EIP-7702 + permissionless (EntryPoint v0.8).
//
// Flow:
//   1. EOA is delegated (type-4 tx) to permissionless impl if not already
//   2. UserOp calls: execute(PAYMASTER, 0, deployRegistry(implementation, name, symbol))
//   3. PlatformPaymaster sponsors gas when userWhitelist[sender] > 0
//
// Run: npx ts-node scripts/deployRegistryGasless.ts
//
// Required .env:
//   PIMLICO_API_KEY      — free at dashboard.pimlico.io
//   OWNER_PRIVATE_KEY    — whitelisted user's key (signs UserOps, needs no ETH)
//   PRIVATE_KEY          — funded wallet (pays gas for delegation tx)
//   SEPOLIA_RPC_URL      — Sepolia RPC
//   PAYMASTER_ADDRESS    — deployed PlatformPaymaster (v0.8 EntryPoint)
//   TDOC_IMPLEMENTATION  — TDoc implementation contract to clone
//   TOKEN_NAME           — name of the TradeTrust token
//   TOKEN_SYMBOL         — symbol of the TradeTrust token

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  parseAbi,
} from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createSmartAccountClient } from "permissionless";
import { to7702SimpleSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { entryPoint08Address } from "viem/account-abstraction";
import * as dotenv from "dotenv";
dotenv.config();

// permissionless's EIP-7702 compatible SimpleAccount (v0.8 EntryPoint)
const PERMISSIONLESS_IMPL =
  "0xe6Cae83BdE06E4c305530e199D7217f42808555B" as const;

const paymasterAbi = parseAbi([
  "function deployRegistry(address implementation, string name, string symbol) external returns (address deployed)",
  "event RegistryDeployed(address indexed user, address indexed deployed, uint256 creditsLeft)",
]);

async function main() {
  if (!process.env.PIMLICO_API_KEY) throw new Error("PIMLICO_API_KEY not set");
  if (!process.env.OWNER_PRIVATE_KEY)
    throw new Error("OWNER_PRIVATE_KEY not set");
  if (!process.env.SEPOLIA_RPC_URL) throw new Error("SEPOLIA_RPC_URL not set");
  if (!process.env.PAYMASTER_ADDRESS)
    throw new Error("PAYMASTER_ADDRESS not set");
  if (!process.env.TDOC_IMPLEMENTATION)
    throw new Error("TDOC_IMPLEMENTATION not set");
  if (!process.env.TOKEN_NAME) throw new Error("TOKEN_NAME not set");
  if (!process.env.TOKEN_SYMBOL) throw new Error("TOKEN_SYMBOL not set");

  const PAYMASTER_ADDR = process.env.PAYMASTER_ADDRESS as `0x${string}`;
  const PIMLICO_URL = `https://api.pimlico.io/v2/11155111/rpc?apikey=${process.env.PIMLICO_API_KEY}`;

  const ownerAccount = privateKeyToAccount(
    process.env.OWNER_PRIVATE_KEY as `0x${string}`,
  );
  const transport = http(process.env.SEPOLIA_RPC_URL);
  const publicClient = createPublicClient({ chain: sepolia, transport });

  console.log("Owner (whitelisted user) :", ownerAccount.address);
  console.log("Paymaster                :", PAYMASTER_ADDR);
  console.log("Permissionless impl      :", PERMISSIONLESS_IMPL);
  console.log("TDoc Implementation      :", process.env.TDOC_IMPLEMENTATION);
  console.log("Token name               :", process.env.TOKEN_NAME);
  console.log("Token symbol             :", process.env.TOKEN_SYMBOL);
  console.log("");

  // Check current delegation — must point to permissionless impl before submitting UserOp.
  // Pimlico simulates validateUserOp against current on-chain code, so re-delegation via
  // the UserOp's authorizationList is too late; we need a type-4 tx first.
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

  // Build the smart account — handles EIP-712 signing and v0.8 delegation automatically
  const account = await to7702SimpleSmartAccount({
    client: publicClient,
    owner: ownerAccount,
  });

  // Custom paymaster middleware — no off-chain data needed, paymaster validates on-chain
  const paymaster = {
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
  };

  const pimlicoClient = createPimlicoClient({
    transport: http(PIMLICO_URL),
    entryPoint: { address: entryPoint08Address, version: "0.8" },
  });

  const smartAccountClient = createSmartAccountClient({
    account,
    chain: sepolia,
    bundlerTransport: http(PIMLICO_URL),
    paymaster,
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

  // deployRegistry calldata — smart account wraps this as execute(PAYMASTER, 0, data)
  const deployRegistryData = encodeFunctionData({
    abi: paymasterAbi,
    functionName: "deployRegistry",
    args: [
      process.env.TDOC_IMPLEMENTATION as `0x${string}`,
      process.env.TOKEN_NAME!,
      process.env.TOKEN_SYMBOL!,
    ],
  });

  console.log("Sending UserOp: deployRegistry via PlatformPaymaster...");
  const txHash = await smartAccountClient.sendTransaction({
    to: PAYMASTER_ADDR,
    value: 0n,
    data: deployRegistryData,
  });

  console.log("\n─────────────────────────────────────────────");
  console.log("Registry deployed gaslessly ✓");
  console.log("  tx      :", txHash);
  console.log("  Deployer:", ownerAccount.address);
  console.log("─────────────────────────────────────────────");
  console.log("\nFind the deployed registry address in the RegistryDeployed");
  console.log("event on tx:", txHash);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
