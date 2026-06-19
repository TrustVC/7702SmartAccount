// Shared EIP-7702 + Pimlico client setup for all pimlicoTR scripts.
//
// Required .env:
//   PIMLICO_API_KEY   — free at dashboard.pimlico.io
//   OWNER_PRIVATE_KEY — EIP-7702 sender / signer
//   SEPOLIA_RPC_URL   — your own Sepolia RPC
//   PRIVATE_KEY       — funded wallet (one-time delegation only)

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  parseGwei,
  toHex,
} from "viem";
import {
  toSmartAccount,
  entryPoint07Abi,
  entryPoint07Address,
  getUserOperationHash,
} from "viem/account-abstraction";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { createSmartAccountClient } from "permissionless";
import * as dotenv from "dotenv";
dotenv.config();

const ENTRY_POINT = entryPoint07Address;
const IMPL_ADDR = (process.env.EIP7702_IMPL_ADDRESS ?? "") as `0x${string}`;
const PAYMASTER_ADDR = (process.env.PAYMASTER_ADDRESS ?? "") as `0x${string}`;

const implAbi = [
  {
    type: "function",
    name: "execute",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bytes" }],
    stateMutability: "payable",
  },
] as const;

export async function buildClient() {
  if (!process.env.PIMLICO_API_KEY) throw new Error("PIMLICO_API_KEY not set");
  if (!process.env.OWNER_PRIVATE_KEY)
    throw new Error("OWNER_PRIVATE_KEY not set");
  if (!process.env.SEPOLIA_RPC_URL) throw new Error("SEPOLIA_RPC_URL not set");
  if (!process.env.EIP7702_IMPL_ADDRESS)
    throw new Error("EIP7702_IMPL_ADDRESS not set");
  if (!process.env.PAYMASTER_ADDRESS)
    throw new Error("PAYMASTER_ADDRESS not set");

  const PIMLICO_URL = `https://api.pimlico.io/v2/11155111/rpc?apikey=${process.env.PIMLICO_API_KEY}`;
  const ownerAccount = privateKeyToAccount(
    process.env.OWNER_PRIVATE_KEY as `0x${string}`,
  );
  const transport = http(process.env.SEPOLIA_RPC_URL);
  const publicClient = createPublicClient({ chain: sepolia, transport });

  const pimlicoClient = createPimlicoClient({
    transport: http(PIMLICO_URL),
    entryPoint: { address: ENTRY_POINT, version: "0.7" },
  });

  const smartAccount = await toSmartAccount({
    client: publicClient,
    entryPoint: { address: ENTRY_POINT, abi: entryPoint07Abi, version: "0.7" },

    async getAddress() {
      return ownerAccount.address;
    },

    async getFactoryArgs() {
      return { factory: undefined, factoryData: undefined };
    },

    async encodeCalls(calls) {
      if (calls.length !== 1) throw new Error("Batch calls not supported");
      const [call] = calls;
      return encodeFunctionData({
        abi: implAbi,
        functionName: "execute",
        args: [call.to, call.value ?? 0n, call.data ?? "0x"],
      });
    },

    async getNonce() {
      return publicClient.readContract({
        address: ENTRY_POINT,
        abi: entryPoint07Abi,
        functionName: "getNonce",
        args: [ownerAccount.address, 0n],
      }) as Promise<bigint>;
    },

    async getStubSignature() {
      return "0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c" as `0x${string}`;
    },

    async signMessage() {
      throw new Error("signMessage not supported");
    },
    async signTypedData() {
      throw new Error("signTypedData not supported");
    },

    async signUserOperation(parameters) {
      const { chainId, ...userOperation } = parameters;
      const hash = getUserOperationHash({
        userOperation: {
          ...userOperation,
          sender: ownerAccount.address,
          signature: "0x",
        } as Parameters<typeof getUserOperationHash>[0]["userOperation"],
        entryPointAddress: ENTRY_POINT,
        entryPointVersion: "0.7",
        chainId: chainId ?? sepolia.id,
      });
      return ownerAccount.sign({ hash });
    },
  });

  // ── EIP-7702 delegation check ────────────────────────────────────────────────
  const senderCode = await publicClient.getCode({
    address: ownerAccount.address,
  });
  const currentDelegate = senderCode?.startsWith("0xef0100")
    ? (`0x${senderCode.slice(8, 48)}` as `0x${string}`)
    : null;

  console.log("Owner EOA         :", ownerAccount.address);
  console.log("Expected delegate :", IMPL_ADDR);
  console.log("Current delegate  :", currentDelegate ?? "none");

  if (
    !currentDelegate ||
    currentDelegate.toLowerCase() !== IMPL_ADDR.toLowerCase()
  ) {
    if (!process.env.PRIVATE_KEY)
      throw new Error("PRIVATE_KEY needed for EIP-7702 delegation");

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

    console.log("(Re-)delegating EOA to implementation...");
    const ownerNonce = await publicClient.getTransactionCount({
      address: ownerAccount.address,
    });
    const authorization = await ownerWallet.signAuthorization({
      contractAddress: IMPL_ADDR,
      nonce: ownerNonce,
    });
    const authTx = await deployerWallet.sendTransaction({
      to: ownerAccount.address,
      data: "0x",
      authorizationList: [authorization],
      gas: 100_000n, // skip eth_estimateGas — nodes often mishandle authorizationList
    });
    await publicClient.waitForTransactionReceipt({ hash: authTx });
    console.log("  Delegated tx:", authTx, "✓");
  } else {
    console.log("  Already delegated — skipping");
  }

  // ── SmartAccountClient ───────────────────────────────────────────────────────
  const MIN = parseGwei("3");
  const smartAccountClient = createSmartAccountClient({
    account: smartAccount,
    chain: sepolia,
    bundlerTransport: http(PIMLICO_URL),
    client: publicClient,
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
          maxFeePerGas: fast.maxFeePerGas > MIN ? fast.maxFeePerGas : MIN,
          maxPriorityFeePerGas:
            fast.maxPriorityFeePerGas > MIN ? fast.maxPriorityFeePerGas : MIN,
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

// Convert a plain UTF-8 string to ABI bytes (hex)
export function toRemarkBytes(s: string): `0x${string}` {
  return toHex(s);
}

// Resolve REGISTRY_ADDRESS from env — shared by all scripts
export function getTRContract(): `0x${string}` {
  if (!process.env.REGISTRY_ADDRESS)
    throw new Error("REGISTRY_ADDRESS not set");
  return process.env.REGISTRY_ADDRESS as `0x${string}`;
}
