// EIP-7702 CRUD via Pimlico bundler.
// Manual UserOp building with raw ECDSA — matches EIP7702Implementation's
// validateUserOp (ECDSA.recover(hash, sig) == address(this), no prefix).
//
// Run: npx hardhat run scripts/crud7702Pimlico.ts --network sepolia
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
  concat,
  toHex,
  pad,
  parseAbi,
  parseGwei,
} from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import * as dotenv from "dotenv";
dotenv.config();

// ── Addresses ─────────────────────────────────────────────────────────────────
// Canonical EntryPoint v0.7 — supported by Pimlico
const ENTRY_POINT =
  "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as `0x${string}`;
// EIP7702Implementation deployed by our factory (canonical EP baked in)
const IMPL_ADDR = "0xECD2812e299c6aD5C3B1F11B91D8Cab83003E09D" as `0x${string}`;
const STORAGE_ADDR =
  "0xeF71781776Bd5F7E3C301EA16378D880B5E52115" as `0x${string}`;
const PAYMASTER_ADDR =
  "0xA7B2B87b3B94C64d8f7a772d2bc1A4E4446a9760" as `0x${string}`;

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
const entryPointAbi = parseAbi([
  "function getNonce(address sender, uint192 key) external view returns (uint256)",
  "function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) external view returns (bytes32)",
]);

// ── Types ─────────────────────────────────────────────────────────────────────
type PackedUserOp = {
  sender: `0x${string}`;
  nonce: bigint;
  initCode: `0x${string}`;
  callData: `0x${string}`;
  accountGasLimits: `0x${string}`;
  preVerificationGas: bigint;
  gasFees: `0x${string}`;
  paymasterAndData: `0x${string}`;
  signature: `0x${string}`;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function pack128(hi: bigint, lo: bigint): `0x${string}` {
  return concat([
    pad(toHex(hi), { size: 16 }),
    pad(toHex(lo), { size: 16 }),
  ]) as `0x${string}`;
}

function withBuffer(hex: `0x${string}`): bigint {
  return (BigInt(hex) * 130n) / 100n;
}

async function bundlerRpc(
  url: string,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as {
    result?: unknown;
    error?: { code?: number; message: string; data?: unknown };
  };
  if (json.error) {
    console.error("Bundler error:", JSON.stringify(json.error, null, 2));
    throw new Error(`Bundler [${method}]: ${json.error.message}`);
  }
  return json.result;
}

async function pollForReceipt(
  url: string,
  opHash: `0x${string}`,
  timeoutMs = 120_000,
): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const receipt = await bundlerRpc(url, "eth_getUserOperationReceipt", [
        opHash,
      ]);
      if (receipt) return receipt;
    } catch {
      /* ignore transient errors */
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(`Timeout waiting for UserOp ${opHash}`);
}

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
  const publicClient = createPublicClient({ chain: sepolia, transport });

  // ── Check Pimlico supports our EntryPoint ──────────────────────────────────
  const supportedEPs = (await bundlerRpc(
    PIMLICO_URL,
    "eth_supportedEntryPoints",
    [],
  )) as string[];
  const epOk = supportedEPs.some(
    (ep) => ep.toLowerCase() === ENTRY_POINT.toLowerCase(),
  );
  if (!epOk) {
    console.error("Pimlico does not support", ENTRY_POINT);
    process.exit(1);
  }
  console.log("Owner EOA  :", ownerAccount.address);
  console.log("EntryPoint :", ENTRY_POINT, "✓");
  console.log("Paymaster  :", PAYMASTER_ADDR);

  // ── Gas prices ────────────────────────────────────────────────────────────
  const { maxFeePerGas, maxPriorityFeePerGas } =
    await publicClient.estimateFeesPerGas();
  const MIN = parseGwei("3");
  const mf = maxFeePerGas
    ? maxFeePerGas > MIN
      ? maxFeePerGas
      : MIN
    : parseGwei("20");
  const mpf = maxPriorityFeePerGas
    ? maxPriorityFeePerGas > MIN
      ? maxPriorityFeePerGas
      : MIN
    : parseGwei("3");

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

  // ── UserOp builder ─────────────────────────────────────────────────────────
  async function runUserOp(storageCalldata: `0x${string}`, step: string) {
    const nonce = (await publicClient.readContract({
      address: ENTRY_POINT,
      abi: entryPointAbi,
      functionName: "getNonce",
      args: [ownerAccount.address, 0n],
    })) as bigint;

    const callData = encodeFunctionData({
      abi: implAbi,
      functionName: "execute",
      args: [STORAGE_ADDR, 0n, storageCalldata],
    });

    // ── pass 1: simulate with generous placeholder gas ─────────────────────
    const SIM = {
      verif: 500_000n,
      call: 500_000n,
      preVerif: 100_000n,
      pmVerif: 300_000n,
      pmPost: 150_000n,
    };
    const simPMData = concat([
      PAYMASTER_ADDR,
      pad(toHex(SIM.pmVerif), { size: 16 }),
      pad(toHex(SIM.pmPost), { size: 16 }),
    ]) as `0x${string}`;

    const simPacked: PackedUserOp = {
      sender: ownerAccount.address,
      nonce,
      initCode: "0x",
      callData,
      accountGasLimits: pack128(SIM.verif, SIM.call),
      preVerificationGas: SIM.preVerif,
      gasFees: pack128(mpf, mf),
      paymasterAndData: simPMData,
      signature: "0x",
    };
    simPacked.signature = await ownerAccount.sign({
      hash: (await publicClient.readContract({
        address: ENTRY_POINT,
        abi: entryPointAbi,
        functionName: "getUserOpHash",
        args: [simPacked],
      })) as `0x${string}`,
    });

    const simRpcOp = {
      sender: simPacked.sender,
      nonce: toHex(nonce),
      callData,
      callGasLimit: toHex(SIM.call),
      verificationGasLimit: toHex(SIM.verif),
      preVerificationGas: toHex(SIM.preVerif),
      maxFeePerGas: toHex(mf),
      maxPriorityFeePerGas: toHex(mpf),
      paymaster: PAYMASTER_ADDR,
      paymasterVerificationGasLimit: toHex(SIM.pmVerif),
      paymasterPostOpGasLimit: toHex(SIM.pmPost),
      paymasterData: "0x",
      signature: simPacked.signature,
    };

    // Retry simulation if Pimlico's node hasn't yet seen the previous op's mined state
    const MAX_SIM_RETRIES = 5;
    let est!: Record<string, `0x${string}`>;
    for (let attempt = 0; attempt <= MAX_SIM_RETRIES; attempt++) {
      if (attempt > 0) {
        console.log(`    Waiting 12s for Pimlico node sync (retry ${attempt}/${MAX_SIM_RETRIES})...`);
        await new Promise((r) => setTimeout(r, 12_000));
      }
      console.log(`\n[${step}] Simulating...`);
      try {
        est = (await bundlerRpc(PIMLICO_URL, "eth_estimateUserOperationGas", [
          simRpcOp,
          ENTRY_POINT,
        ])) as Record<string, `0x${string}`>;
        console.log("    Simulation OK:", JSON.stringify(est));
        break;
      } catch (err) {
        const msg = (err as Error).message;
        console.error("    Simulation FAILED:", msg);
        if (attempt === MAX_SIM_RETRIES || !msg.includes("execution failed")) throw err;
      }
    }

    // ── pass 2: build final op with simulated gas + 30 % buffer ───────────
    const G = {
      verif: withBuffer(est.verificationGasLimit),
      call: withBuffer(est.callGasLimit),
      preVerif: withBuffer(est.preVerificationGas),
      pmVerif: withBuffer(est.paymasterVerificationGasLimit),
      pmPost: withBuffer(est.paymasterPostOpGasLimit),
    };

    const finalPMData = concat([
      PAYMASTER_ADDR,
      pad(toHex(G.pmVerif), { size: 16 }),
      pad(toHex(G.pmPost), { size: 16 }),
    ]) as `0x${string}`;

    const packed: PackedUserOp = {
      sender: ownerAccount.address,
      nonce,
      initCode: "0x",
      callData,
      accountGasLimits: pack128(G.verif, G.call),
      preVerificationGas: G.preVerif,
      gasFees: pack128(mpf, mf),
      paymasterAndData: finalPMData,
      signature: "0x",
    };
    // Raw ECDSA — no Ethereum prefix — matches EIP7702Implementation._validateSignature
    packed.signature = await ownerAccount.sign({
      hash: (await publicClient.readContract({
        address: ENTRY_POINT,
        abi: entryPointAbi,
        functionName: "getUserOpHash",
        args: [packed],
      })) as `0x${string}`,
    });

    const rpcOp = {
      sender: packed.sender,
      nonce: toHex(nonce),
      callData,
      callGasLimit: toHex(G.call),
      verificationGasLimit: toHex(G.verif),
      preVerificationGas: toHex(G.preVerif),
      maxFeePerGas: toHex(mf),
      maxPriorityFeePerGas: toHex(mpf),
      paymaster: PAYMASTER_ADDR,
      paymasterVerificationGasLimit: toHex(G.pmVerif),
      paymasterPostOpGasLimit: toHex(G.pmPost),
      paymasterData: "0x",
      signature: packed.signature,
    };

    console.log(`    Submitting  nonce=${nonce}`);
    const opHash = (await bundlerRpc(PIMLICO_URL, "eth_sendUserOperation", [
      rpcOp,
      ENTRY_POINT,
    ])) as `0x${string}`;
    console.log("    UserOpHash:", opHash);

    console.log("    Waiting for receipt...");
    const receipt = await pollForReceipt(PIMLICO_URL, opHash);
    const txHash = (receipt as { receipt: { transactionHash: string } }).receipt
      .transactionHash;
    console.log(`    Success  txHash: ${txHash}`);
    return receipt;
  }

  // ── Wait for on-chain state to be visible on Pimlico's simulation node ────
  async function waitForCount(expected: bigint, label: string) {
    process.stdout.write(`    Waiting for ${label} to be visible on-chain...`);
    for (let i = 0; i < 30; i++) {
      const count = (await publicClient.readContract({
        address: STORAGE_ADDR, abi: storageAbi, functionName: "getItemCount",
      })) as bigint;
      if (count >= expected) { console.log(` ✓ (itemCount=${count})`); return; }
      process.stdout.write(".");
      await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`Timeout waiting for itemCount >= ${expected}`);
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────
  await runUserOp(
    encodeFunctionData({ abi: storageAbi, functionName: "create", args: ["Hello via EIP-7702 + Pimlico!"] }),
    "CREATE",
  );
  // Wait for CREATE to be visible before simulating UPDATE
  const itemId = (await publicClient.readContract({
    address: STORAGE_ADDR, abi: storageAbi, functionName: "getItemCount",
  })) as bigint;
  console.log("    itemCount after CREATE:", itemId);
  await waitForCount(itemId, "CREATE");
  // Extra delay so Pimlico's simulation node mirrors the mined CREATE state
  process.stdout.write("    Giving Pimlico 15s to sync...");
  await new Promise((r) => setTimeout(r, 15_000));
  console.log(" done");

  await runUserOp(
    encodeFunctionData({ abi: storageAbi, functionName: "update", args: [itemId, "Updated via Pimlico!"] }),
    "UPDATE",
  );
  await waitForCount(itemId, "UPDATE");

  await runUserOp(
    encodeFunctionData({ abi: storageAbi, functionName: "remove", args: [itemId] }),
    "DELETE",
  );
  console.log("    Exists after delete:", await publicClient.readContract({
    address: STORAGE_ADDR, abi: storageAbi, functionName: "exists", args: [itemId],
  }));

  console.log("\nAll CRUD ops complete via Pimlico ✓");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
