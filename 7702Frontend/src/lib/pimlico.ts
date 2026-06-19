// Uses permissionless to7702SimpleSmartAccount (EntryPoint v0.8).
//
// Why v0.8:
//   - Signs UserOps via signTypedData (EIP-712) — MetaMask supports eth_signTypedData_v4
//   - EntryPoint v0.8 includes EIP-7702 delegation inside the UserOp itself,
//     so the bundler sends the type-4 tx — MetaMask never needs to handle it directly
//
// Paymaster: Pimlico's own verifying paymaster (pm_getPaymasterData).

import { createPublicClient, createWalletClient, custom, http, toHex } from "viem";
import { entryPoint08Address } from "viem/account-abstraction";
import { sepolia } from "viem/chains";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { createSmartAccountClient } from "permissionless";
import { to7702SimpleSmartAccount } from "permissionless/accounts";

import { PIMLICO_URL, SEPOLIA_RPC_URL } from "./constants";

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

// Builds a smart account client using permissionless to7702SimpleSmartAccount.
//   - WalletClient with ownerAddress matches the expected WalletClient<Transport,Chain,Account> type
//   - Signing: signTypedData (EIP-712) via MetaMask — no eth_sign needed
//   - Delegation to PERMISSIONLESS_IMPL handled automatically on the first UserOp
export async function buildSmartAccountClient(ownerAddress: `0x${string}`) {
  if (!window.ethereum) throw new Error("MetaMask not found");

  // account must be set explicitly so the type resolves to WalletClient<Transport,Chain,Account>
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
    // entryPoint defaults to v0.8 — no need to pass it
  });

  const smartAccountClient = createSmartAccountClient({
    account,
    chain: sepolia,
    bundlerTransport: http(PIMLICO_URL),
    client: publicClient,
    // pimlicoClient as paymaster → calls pm_getPaymasterData (Pimlico verifying paymaster)
    paymaster: pimlicoClient,
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
