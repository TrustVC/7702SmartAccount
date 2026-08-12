// Shared EIP-7702 + permissionless client setup for all trFunctions scripts.
// Uses EntryPoint v0.8 with to7702SimpleSmartAccount (EIP-712 signing).
//
// Required .env:
//   NETWORK                      — sepolia | amoy  (default: sepolia)
//   PIMLICO_API_KEY              — free at dashboard.pimlico.io
//   OWNER_PRIVATE_KEY            — EIP-7702 sender / signer
//   SEPOLIA_RPC_URL / AMOY_RPC_URL
//   PAYMASTER_ADDRESS_<NETWORK>  — deployed PlatformPaymaster (v0.8 EntryPoint)
//   PRIVATE_KEY                  — funded wallet (pays gas for delegation tx if needed)

import { createPublicClient, createWalletClient, http, toHex } from "viem";
import { entryPoint08Address } from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { createSmartAccountClient } from "permissionless";
import { to7702SimpleSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import * as dotenv from "dotenv";
import { getNetworkConfig, getEnv } from "../lib/network";
dotenv.config();

const PERMISSIONLESS_IMPL = "0xe6Cae83BdE06E4c305530e199D7217f42808555B" as const;

export async function buildClient() {
  if (!process.env.PIMLICO_API_KEY) throw new Error("PIMLICO_API_KEY not set");
  if (!process.env.OWNER_PRIVATE_KEY) throw new Error("OWNER_PRIVATE_KEY not set");

  const networkName = process.env.NETWORK ?? "sepolia";
  const { chain, rpcUrl, chainId, suffix } = getNetworkConfig(networkName);
  const PAYMASTER_ADDR = getEnv(suffix, "PAYMASTER_ADDRESS") as `0x${string}`;
  const PIMLICO_URL = `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${process.env.PIMLICO_API_KEY}`;

  const ownerAccount = privateKeyToAccount(process.env.OWNER_PRIVATE_KEY as `0x${string}`);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain, transport });

  console.log("Network           :", networkName);
  console.log("Owner EOA         :", ownerAccount.address);
  console.log("Expected delegate :", PERMISSIONLESS_IMPL);

  const code = await publicClient.getCode({ address: ownerAccount.address });
  const currentDelegate = code?.startsWith("0xef0100")
    ? (`0x${code.slice(8, 48)}` as `0x${string}`)
    : null;
  console.log("Current delegate  :", currentDelegate ?? "none");

  if (currentDelegate?.toLowerCase() !== PERMISSIONLESS_IMPL.toLowerCase()) {
    if (!process.env.PRIVATE_KEY)
      throw new Error("PRIVATE_KEY needed for EIP-7702 delegation (pays gas)");

    const deployerAccount = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
    const ownerWallet = createWalletClient({ account: ownerAccount, chain, transport });
    const deployerWallet = createWalletClient({ account: deployerAccount, chain, transport });

    console.log("(Re-)delegating EOA to permissionless impl...");
    const ownerNonce = await publicClient.getTransactionCount({ address: ownerAccount.address });
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

  const account = await to7702SimpleSmartAccount({ client: publicClient, owner: ownerAccount });

  const pimlicoClient = createPimlicoClient({
    transport: http(PIMLICO_URL),
    entryPoint: { address: entryPoint08Address, version: "0.8" },
  });

  const smartAccountClient = createSmartAccountClient({
    account,
    chain,
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
        return { maxFeePerGas: fast.maxFeePerGas, maxPriorityFeePerGas: fast.maxPriorityFeePerGas };
      },
    },
  });

  return { smartAccountClient, publicClient, ownerAddress: ownerAccount.address, suffix };
}

export function toRemarkBytes(s: string): `0x${string}` {
  return toHex(s);
}

export function getTRContract(suffix: string): `0x${string}` {
  return getEnv(suffix, "TITLE_ESCROW_ADDRESS") as `0x${string}`;
}
