// Shared EIP-7702 + permissionless client setup for all trFunctions scripts.
// Uses EntryPoint v0.8 with to7702SimpleSmartAccount (EIP-712 signing).
//
// Required .env:
//   PIMLICO_API_KEY   — free at dashboard.pimlico.io
//   OWNER_PRIVATE_KEY — EIP-7702 sender / signer
//   SEPOLIA_RPC_URL   — your own Sepolia RPC
//   PAYMASTER_ADDRESS — deployed PlatformPaymaster (v0.8 EntryPoint)
//   PRIVATE_KEY       — funded wallet (pays gas for delegation tx if needed)

import { createPublicClient, createWalletClient, http, toHex } from "viem";
import { entryPoint08Address } from "viem/account-abstraction";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createSmartAccountClient } from "permissionless";
import { to7702SimpleSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import * as dotenv from "dotenv";
dotenv.config();

// permissionless's EIP-7702 compatible SimpleAccount (v0.8 EntryPoint)
const PERMISSIONLESS_IMPL =
  "0xe6Cae83BdE06E4c305530e199D7217f42808555B" as const;

export async function buildClient() {
  if (!process.env.PIMLICO_API_KEY) throw new Error("PIMLICO_API_KEY not set");
  if (!process.env.OWNER_PRIVATE_KEY)
    throw new Error("OWNER_PRIVATE_KEY not set");
  if (!process.env.SEPOLIA_RPC_URL) throw new Error("SEPOLIA_RPC_URL not set");
  if (!process.env.PAYMASTER_ADDRESS)
    throw new Error("PAYMASTER_ADDRESS not set");

  const PAYMASTER_ADDR = process.env.PAYMASTER_ADDRESS as `0x${string}`;
  const PIMLICO_URL = `https://api.pimlico.io/v2/11155111/rpc?apikey=${process.env.PIMLICO_API_KEY}`;

  const ownerAccount = privateKeyToAccount(
    process.env.OWNER_PRIVATE_KEY as `0x${string}`,
  );
  const transport = http(process.env.SEPOLIA_RPC_URL);
  const publicClient = createPublicClient({ chain: sepolia, transport });

  // Delegation check — must point to permissionless impl before submitting UserOp.
  // Pimlico simulates validateUserOp against current on-chain code, so the delegation
  // must be set via a type-4 tx before the UserOp is submitted.
  const code = await publicClient.getCode({ address: ownerAccount.address });
  const currentDelegate = code?.startsWith("0xef0100")
    ? (`0x${code.slice(8, 48)}` as `0x${string}`)
    : null;

  console.log("Owner EOA         :", ownerAccount.address);
  console.log("Expected delegate :", PERMISSIONLESS_IMPL);
  console.log("Current delegate  :", currentDelegate ?? "none");

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

    console.log("(Re-)delegating EOA to permissionless impl...");
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
      gas: 100_000n,
    });
    await publicClient.waitForTransactionReceipt({ hash: authTx });
    console.log("  Delegated tx:", authTx, "✓");
  } else {
    console.log("  Already delegated — skipping");
  }

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
          paymasterVerificationGasLimit: 300_000n,
          paymasterPostOpGasLimit: 150_000n,
          isFinal: false,
        };
      },
      async getPaymasterData() {
        return {
          paymaster: PAYMASTER_ADDR,
          paymasterData: "0x" as `0x${string}`,
          paymasterVerificationGasLimit: 300_000n,
          paymasterPostOpGasLimit: 150_000n,
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

  return {
    smartAccountClient,
    publicClient,
    ownerAddress: ownerAccount.address,
  };
}

export function toRemarkBytes(s: string): `0x${string}` {
  return toHex(s);
}

export function getTRContract(): `0x${string}` {
  if (!process.env.TITLE_ESCROW_ADDRESS)
    throw new Error("TITLE_ESCROW_ADDRESS not set");
  return process.env.TITLE_ESCROW_ADDRESS as `0x${string}`;
}
