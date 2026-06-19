// Gasless TDoc registry deployment via EIP-7702 + Pimlico bundler.
//
// Calls: execute(paymasterAddress, 0, deployRegistry(implementation, params))
// The PlatformPaymaster sponsors gas when target == address(this) and
// userWhitelist[sender] > 0.
//
// Run: npx hardhat run scripts/deployRegistryGasless.ts --network sepolia
//
// Required .env:
//   PIMLICO_API_KEY      — free at dashboard.pimlico.io
//   OWNER_PRIVATE_KEY    — whitelisted user's key (signs UserOps, needs no ETH)
//   SEPOLIA_RPC_URL      — Sepolia RPC
//   PRIVATE_KEY          — funded wallet (one-time EIP-7702 delegation only)
//   PAYMASTER_ADDRESS    — deployed PlatformPaymaster
//   EIP7702_IMPL_ADDRESS         — EIP7702Implementation address (from factory)
//   TDOC_IMPLEMENTATION  — TDoc implementation contract to clone
//   TOKEN_NAME           — name of the TradeTrust token (e.g. "My Document Token")
//   TOKEN_SYMBOL         — symbol of the TradeTrust token (e.g. "MDT")
//   (TOKEN_ADMIN is no longer needed — the contract grants DEFAULT_ADMIN_ROLE to the
//    calling EOA and keeps MINTER_ROLE/RESTORER_ROLE/ACCEPTER_ROLE on the paymaster)

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

const ENTRY_POINT =
  "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as `0x${string}`;

const implAbi = parseAbi([
  "function execute(address to, uint256 value, bytes calldata data) external returns (bytes memory)",
]);

const paymasterAbi = parseAbi([
  "function deployRegistry(address implementation, string name, string symbol) external returns (address deployed)",
]);

const entryPointAbi = parseAbi([
  "function getNonce(address sender, uint192 key) external view returns (uint256)",
  "function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) external view returns (bytes32)",
]);

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

async function main() {
  if (!process.env.PIMLICO_API_KEY) throw new Error("PIMLICO_API_KEY not set");
  if (!process.env.OWNER_PRIVATE_KEY)
    throw new Error("OWNER_PRIVATE_KEY not set");
  if (!process.env.SEPOLIA_RPC_URL) throw new Error("SEPOLIA_RPC_URL not set");
  if (!process.env.PAYMASTER_ADDRESS)
    throw new Error("PAYMASTER_ADDRESS not set");
  if (!process.env.EIP7702_IMPL_ADDRESS)
    throw new Error("EIP7702_IMPL_ADDRESS not set");
  if (!process.env.TDOC_IMPLEMENTATION)
    throw new Error("TDOC_IMPLEMENTATION not set");
  if (!process.env.TOKEN_NAME) throw new Error("TOKEN_NAME not set");
  if (!process.env.TOKEN_SYMBOL) throw new Error("TOKEN_SYMBOL not set");

  const PAYMASTER_ADDR = process.env.PAYMASTER_ADDRESS as `0x${string}`;
  const IMPL_ADDR = process.env.EIP7702_IMPL_ADDRESS as `0x${string}`;
  const tdocImplementation = process.env.TDOC_IMPLEMENTATION as `0x${string}`;

  const PIMLICO_URL = `https://api.pimlico.io/v2/11155111/rpc?apikey=${process.env.PIMLICO_API_KEY}`;

  const ownerAccount = privateKeyToAccount(
    process.env.OWNER_PRIVATE_KEY as `0x${string}`,
  );
  const transport = http(process.env.SEPOLIA_RPC_URL);
  const publicClient = createPublicClient({ chain: sepolia, transport });

  console.log("Owner (whitelisted user) :", ownerAccount.address);
  console.log("Paymaster                :", PAYMASTER_ADDR);
  console.log("EIP7702 Implementation   :", IMPL_ADDR);
  console.log("TDoc Implementation      :", tdocImplementation);
  console.log("Token name               :", process.env.TOKEN_NAME);
  console.log("Token symbol             :", process.env.TOKEN_SYMBOL);
  console.log(
    "Token admin              : (set by paymaster → calling EOA gets DEFAULT_ADMIN_ROLE)",
  );

  // ── Check Pimlico supports our EntryPoint ──────────────────────────────────
  const supportedEPs = (await bundlerRpc(
    PIMLICO_URL,
    "eth_supportedEntryPoints",
    [],
  )) as string[];
  if (
    !supportedEPs.some((ep) => ep.toLowerCase() === ENTRY_POINT.toLowerCase())
  ) {
    throw new Error(`Pimlico does not support EntryPoint ${ENTRY_POINT}`);
  }
  console.log("\nEntryPoint :", ENTRY_POINT, "✓");

  // ── Gas prices ─────────────────────────────────────────────────────────────
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

    console.log("\n(Re-)delegating EOA to EIP7702Implementation...");
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
    console.log("  Delegated tx:", authTx);
  } else {
    console.log("  Already delegated correctly — skipping");
  }

  // ── Build callData: execute(paymaster, 0, deployRegistry(impl, name, symbol)) ─
  const innerCalldata = encodeFunctionData({
    abi: paymasterAbi,
    functionName: "deployRegistry",
    args: [
      tdocImplementation,
      process.env.TOKEN_NAME!,
      process.env.TOKEN_SYMBOL!,
    ],
  });

  const callData = encodeFunctionData({
    abi: implAbi,
    functionName: "execute",
    args: [PAYMASTER_ADDR, 0n, innerCalldata],
  });

  // ── UserOp ────────────────────────────────────────────────────────────────
  const nonce = (await publicClient.readContract({
    address: ENTRY_POINT,
    abi: entryPointAbi,
    functionName: "getNonce",
    args: [ownerAccount.address, 0n],
  })) as bigint;

  // Pass 1: simulate with generous placeholder gas
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

  console.log("\nSimulating UserOp...");
  const est = (await bundlerRpc(PIMLICO_URL, "eth_estimateUserOperationGas", [
    simRpcOp,
    ENTRY_POINT,
  ])) as Record<string, `0x${string}`>;
  console.log("  Simulation OK:", JSON.stringify(est));

  // Pass 2: final op with simulated gas + 30% buffer
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

  console.log("\nSubmitting UserOp (nonce=" + nonce + ")...");
  const opHash = (await bundlerRpc(PIMLICO_URL, "eth_sendUserOperation", [
    rpcOp,
    ENTRY_POINT,
  ])) as `0x${string}`;
  console.log("  UserOpHash:", opHash);

  console.log("  Waiting for receipt...");
  const receipt = await pollForReceipt(PIMLICO_URL, opHash);
  const txHash = (receipt as { receipt: { transactionHash: string } }).receipt
    .transactionHash;

  console.log("\n─────────────────────────────────────────────");
  console.log("Registry deployed gaslessly ✓");
  console.log("  tx          :", txHash);
  console.log("  UserOpHash  :", opHash);
  console.log("  Deployer    :", ownerAccount.address);
  console.log("─────────────────────────────────────────────");
  console.log(
    "\nNote: find the deployed registry address in the RegistryDeployed",
  );
  console.log("event on tx:", txHash);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
