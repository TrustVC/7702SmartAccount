import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  toHex,
} from "viem";
import { entryPoint08Address } from "viem/account-abstraction";
import { sepolia } from "viem/chains";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { createSmartAccountClient } from "permissionless";
import { to7702SimpleSmartAccount } from "permissionless/accounts";

import { PAYMASTER_ADDRESS, PIMLICO_URL, SEPOLIA_RPC_URL } from "./constants";

// permissionless's EIP-7702 compatible SimpleAccount for v0.8
export const PERMISSIONLESS_IMPL =
  "0xe6Cae83BdE06E4c305530e199D7217f42808555B" as const;

export function getPublicClient() {
  return createPublicClient({
    chain: sepolia,
    transport: http(SEPOLIA_RPC_URL),
  });
}

export async function checkDelegation(address: `0x${string}`) {
  const publicClient = getPublicClient();
  const code = await publicClient.getCode({ address });
  if (!code || code === "0x") return null;
  if (code.startsWith("0xef0100")) {
    return `0x${code.slice(8, 48)}` as `0x${string}`;
  }
  return null;
}

export async function buildSmartAccountClient(
  ownerAddress: `0x${string}`,
  paymasterOverride?: `0x${string}`,
) {
  if (!window.ethereum) throw new Error("MetaMask not found");

  const PAYMASTER = paymasterOverride ?? PAYMASTER_ADDRESS;
  if (!PAYMASTER || PAYMASTER === "0x")
    throw new Error("No paymaster address configured");

  const walletClient = createWalletClient({
    account: ownerAddress,
    chain: sepolia,
    transport: custom(window.ethereum),
  });

  const publicClient = getPublicClient();

  const pimlicoClient = createPimlicoClient({
    transport: http(PIMLICO_URL),
    entryPoint: { address: entryPoint08Address, version: "0.8" },
  });

  const account = await to7702SimpleSmartAccount({
    client: publicClient,
    owner: walletClient,
  });

  const smartAccountClient = createSmartAccountClient({
    account,
    chain: sepolia,
    bundlerTransport: http(PIMLICO_URL),
    client: publicClient,
    // Custom PlatformPaymaster — validates on-chain, no off-chain signature needed
    paymaster: {
      async getPaymasterStubData() {
        return {
          paymaster: PAYMASTER as `0x${string}`,
          paymasterData: "0x" as `0x${string}`,
          paymasterVerificationGasLimit: 300_000n,
          paymasterPostOpGasLimit: 150_000n,
          isFinal: false,
        };
      },
      async getPaymasterData() {
        return {
          paymaster: PAYMASTER as `0x${string}`,
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

  return { smartAccountClient, publicClient };
}

export function toRemarkBytes(s: string): `0x${string}` {
  return toHex(s);
}
