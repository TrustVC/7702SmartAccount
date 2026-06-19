// EIP-7702 CRUD via Pimlico bundler — permissionless.js edition.
//
// Uses permissionless.js's createPimlicoClient + createSmartAccountClient.
// The smart account is built with viem's toSmartAccount so we can override
// signUserOperation to use raw ECDSA (no EIP-191 prefix), matching our
// EIP7702Implementation's SignerEIP7702 validator.
// Our on-chain PaymasterV2 sponsors gas — no Pimlico verifying paymaster.
//
// Run: npx hardhat run scripts/crud7702PimlicoPermissionless.ts --network sepolia
//
// Required .env:
//   PIMLICO_API_KEY   — free at dashboard.pimlico.io
//   OWNER_PRIVATE_KEY — storage owner, signs UserOps (no ETH needed after delegation)
//   SEPOLIA_RPC_URL   — your Sepolia RPC endpoint
//   PRIVATE_KEY       — funded wallet (one-time: EIP-7702 delegation if needed)

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  parseAbi,
  parseGwei,
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

// ── Addresses ─────────────────────────────────────────────────────────────────
const ENTRY_POINT = entryPoint07Address; // 0x0000000071727De22E5E9d8BAf0edAc6f37da032
const IMPL_ADDR =
  "0xECD2812e299c6aD5C3B1F11B91D8Cab83003E09D" as `0x${string}`;
const STORAGE_ADDR =
  "0xeF71781776Bd5F7E3C301EA16378D880B5E52115" as `0x${string}`;
const PAYMASTER_ADDR =
  "0xbdd57218ac281eE281A92051C699751738E687Be" as `0x${string}`;

// ── ABIs ──────────────────────────────────────────────────────────────────────
const implAbi = parseAbi([
  "function execute(address to, uint256 value, bytes calldata data) external returns (bytes memory)",
]);
const storageAbi = parseAbi([
  "function create(string memory _data) external returns (uint)",
  "function update(uint _id, string memory _newData) external",
  "function remove(uint _id) external",
  "function getItemCount() external view returns (uint)",
  "function exists(uint _id) external view returns (bool)",
]);

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.PIMLICO_API_KEY) throw new Error("PIMLICO_API_KEY not set");
  if (!process.env.OWNER_PRIVATE_KEY)
    throw new Error("OWNER_PRIVATE_KEY not set");

  const PIMLICO_URL = `https://api.pimlico.io/v2/11155111/rpc?apikey=${process.env.PIMLICO_API_KEY}`;

  const ownerAccount = privateKeyToAccount(
    process.env.OWNER_PRIVATE_KEY as `0x${string}`,
  );
  const transport = http(process.env.SEPOLIA_RPC_URL);

  // All standard RPC calls go to our own Sepolia node, not Pimlico
  const publicClient = createPublicClient({ chain: sepolia, transport });

  // ── Pimlico client — bundler + gas price only ──────────────────────────────
  const pimlicoClient = createPimlicoClient({
    transport: http(PIMLICO_URL),
    entryPoint: { address: ENTRY_POINT, version: "0.7" },
  });

  // ── Custom EIP-7702 smart account ──────────────────────────────────────────
  // We use viem's toSmartAccount directly so we can wire raw-ECDSA signing.
  // SignerEIP7702 (OZ) expects: ECDSA.recover(userOpHash, sig) == address(this)
  // — no Ethereum message prefix. toSimpleSmartAccount uses signMessage (EIP-191),
  // which would fail AA24; we override signUserOperation with ownerAccount.sign.
  const smartAccount = await toSmartAccount({
    client: publicClient,
    entryPoint: {
      address: ENTRY_POINT,
      abi: entryPoint07Abi,
      version: "0.7",
    },

    async getAddress() {
      return ownerAccount.address;
    },

    // EIP-7702 account already exists — no factory / init code needed
    async getFactoryArgs() {
      return { factory: undefined, factoryData: undefined };
    },

    // Encode a single call through our execute(address,uint256,bytes) entrypoint
    async encodeCalls(calls) {
      if (calls.length !== 1) {
        throw new Error("Batch calls not supported by this account");
      }
      const [call] = calls;
      return encodeFunctionData({
        abi: implAbi,
        functionName: "execute",
        args: [call.to, call.value ?? 0n, call.data ?? "0x"],
      });
    },

    // Read nonce from EntryPoint contract (key = 0)
    async getNonce() {
      return publicClient.readContract({
        address: ENTRY_POINT,
        abi: entryPoint07Abi,
        functionName: "getNonce",
        args: [ownerAccount.address, 0n],
      }) as Promise<bigint>;
    },

    // Dummy signature used during gas estimation — valid ECDSA length/shape
    async getStubSignature() {
      return "0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c" as `0x${string}`;
    },

    // ERC-1271 not used — our account only validates UserOp signatures
    async signMessage() {
      throw new Error("signMessage not supported");
    },
    async signTypedData() {
      throw new Error("signTypedData not supported");
    },

    // Raw ECDSA sign — no Ethereum prefix — matches SignerEIP7702._rawSignatureValidation
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

  console.log("Owner EOA  :", ownerAccount.address);
  console.log("EntryPoint :", ENTRY_POINT, "✓");
  console.log("Paymaster  :", PAYMASTER_ADDR);

  // ── EIP-7702 delegation check ──────────────────────────────────────────────
  const senderCode = await publicClient.getCode({
    address: ownerAccount.address,
  });
  const currentDelegate = senderCode?.startsWith("0xef0100")
    ? (`0x${senderCode.slice(8, 48)}` as `0x${string}`)
    : null;

  console.log("\nExpected delegate:", IMPL_ADDR);
  console.log("Current delegate :", currentDelegate ?? "none");

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

    console.log("\n(Re-)delegating EOA...");
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
    });
    await publicClient.waitForTransactionReceipt({ hash: authTx });
    console.log("    Delegated tx:", authTx);
  } else {
    console.log("    Already delegated correctly — skipping");
  }

  // ── SmartAccountClient ─────────────────────────────────────────────────────
  // createSmartAccountClient ties the custom account to Pimlico's bundler.
  // The paymaster object instructs the client to sponsor via our PaymasterV2
  // instead of Pimlico's verifying paymaster — no off-chain service required.
  const MIN = parseGwei("3");
  const smartAccountClient = createSmartAccountClient({
    account: smartAccount,
    chain: sepolia,
    bundlerTransport: http(PIMLICO_URL),
    // Pipe standard eth_* calls to our own Sepolia node, not Pimlico
    client: publicClient,
    // On-chain PaymasterV2 — paymasterData is empty (contract reads callData itself)
    paymaster: {
      async getPaymasterStubData(_userOp) {
        return {
          paymaster: PAYMASTER_ADDR,
          paymasterData: "0x" as `0x${string}`,
          paymasterVerificationGasLimit: 300_000n,
          paymasterPostOpGasLimit: 150_000n,
          isFinal: false,
        };
      },
      async getPaymasterData(_userOp) {
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
          maxFeePerGas:
            fast.maxFeePerGas > MIN ? fast.maxFeePerGas : MIN,
          maxPriorityFeePerGas:
            fast.maxPriorityFeePerGas > MIN ? fast.maxPriorityFeePerGas : MIN,
        };
      },
    },
  });

  // ── UserOp helper ──────────────────────────────────────────────────────────
  async function runOp(storageCalldata: `0x${string}`, step: string) {
    console.log(`\n[${step}] Sending UserOp...`);
    const txHash = await smartAccountClient.sendTransaction({
      to: STORAGE_ADDR,
      value: 0n,
      data: storageCalldata,
    });
    console.log(`    Success  txHash: ${txHash}`);
    return txHash;
  }

  // ── Wait for state to be visible on Pimlico's simulation node ─────────────
  async function waitForCount(expected: bigint, label: string) {
    process.stdout.write(`    Waiting for ${label} to be visible on-chain...`);
    for (let i = 0; i < 30; i++) {
      const count = (await publicClient.readContract({
        address: STORAGE_ADDR,
        abi: storageAbi,
        functionName: "getItemCount",
      })) as bigint;
      if (count >= expected) {
        console.log(` ✓ (itemCount=${count})`);
        return;
      }
      process.stdout.write(".");
      await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`Timeout waiting for itemCount >= ${expected}`);
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────
  await runOp(
    encodeFunctionData({
      abi: storageAbi,
      functionName: "create",
      args: ["Hello via EIP-7702 + permissionless.js!"],
    }),
    "CREATE",
  );

  const itemId = (await publicClient.readContract({
    address: STORAGE_ADDR,
    abi: storageAbi,
    functionName: "getItemCount",
  })) as bigint;
  console.log("    itemCount after CREATE:", itemId);
  await waitForCount(itemId, "CREATE");

  // Allow Pimlico's simulation node extra time to reflect the mined CREATE tx
  process.stdout.write("    Giving Pimlico 15s to sync...");
  await new Promise((r) => setTimeout(r, 15_000));
  console.log(" done");

  await runOp(
    encodeFunctionData({
      abi: storageAbi,
      functionName: "update",
      args: [itemId, "Updated via permissionless.js!"],
    }),
    "UPDATE",
  );
  await waitForCount(itemId, "UPDATE");

  await runOp(
    encodeFunctionData({
      abi: storageAbi,
      functionName: "remove",
      args: [itemId],
    }),
    "DELETE",
  );
  console.log(
    "    Exists after delete:",
    await publicClient.readContract({
      address: STORAGE_ADDR,
      abi: storageAbi,
      functionName: "exists",
      args: [itemId],
    }),
  );

  console.log("\nAll CRUD ops complete via permissionless.js + Pimlico ✓");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
