// EIP-7702 CRUD script — runs all four Storage operations through ERC-4337 UserOps,
// gas sponsored by RegistryPaymaster. The owner EOA needs zero ETH.
//
// Run: npx hardhat run scripts/crud7702.ts --network sepolia
//
// Required .env additions:
//   OWNER_PRIVATE_KEY  — private key of the Storage owner (beneficiary/holder), no ETH needed
//   PAYMASTER_ADDRESS  — address of the deployed RegistryPaymaster (check ClientOnboarded event)

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  keccak256,
  encodeAbiParameters,
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

// ── Deployed addresses ────────────────────────────────────────────────────────
const ENTRY_POINT =
  "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as `0x${string}`;
const FACTORY_ADDR =
  "0x7F83636b4e35B3b2CcB00Ec8dF7762e53cBF0937" as `0x${string}`;
const STORAGE_ADDR =
  "0xeF71781776Bd5F7E3C301EA16378D880B5E52115" as `0x${string}`;
const PAYMASTER_ADDR = (process.env.PAYMASTER_ADDRESS ?? "") as `0x${string}`;

// ── ABIs ──────────────────────────────────────────────────────────────────────
const factoryAbi = parseAbi([
  "function implementation7702() external view returns (address)",
]);

const entryPointAbi = parseAbi([
  "function getNonce(address sender, uint192 key) external view returns (uint256)",
  "function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops, address payable beneficiary) external",
]);

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

// Pack two uint128 values into a single bytes32
function pack128(hi: bigint, lo: bigint): `0x${string}` {
  return concat([
    pad(toHex(hi), { size: 16 }),
    pad(toHex(lo), { size: 16 }),
  ]) as `0x${string}`;
}

// ERC-4337 v0.7 (PackedUserOperation) hash — matches EntryPoint.getUserOpHash()
function getUserOpHash(op: PackedUserOp, chainId: number): `0x${string}` {
  const innerHash = keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        op.sender,
        op.nonce,
        keccak256(op.initCode),
        keccak256(op.callData),
        op.accountGasLimits,
        op.preVerificationGas,
        op.gasFees,
        keccak256(op.paymasterAndData),
      ],
    ),
  );
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
      [innerHash, ENTRY_POINT, BigInt(chainId)],
    ),
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY not set in .env");
  if (!process.env.OWNER_PRIVATE_KEY)
    throw new Error("OWNER_PRIVATE_KEY not set in .env");
  if (!PAYMASTER_ADDR) throw new Error("PAYMASTER_ADDRESS not set in .env");

  const deployerAccount = privateKeyToAccount(
    process.env.PRIVATE_KEY as `0x${string}`,
  );
  const ownerAccount = privateKeyToAccount(
    process.env.OWNER_PRIVATE_KEY as `0x${string}`,
  );

  const transport = http(process.env.SEPOLIA_RPC_URL);

  const publicClient = createPublicClient({ chain: sepolia, transport });
  const deployerWallet = createWalletClient({
    account: deployerAccount,
    chain: sepolia,
    transport,
  });
  const ownerWallet = createWalletClient({
    account: ownerAccount,
    chain: sepolia,
    transport,
  });

  console.log("Deployer :", deployerAccount.address);
  console.log("Owner EOA:", ownerAccount.address);

  // ── 1. Resolve implementation address ─────────────────────────────────────
  const implementation7702 = (await publicClient.readContract({
    address: FACTORY_ADDR,
    abi: factoryAbi,
    functionName: "implementation7702",
  })) as `0x${string}`;
  console.log("\n[1] EIP7702Implementation:", implementation7702);

  // ── 2. Set EIP-7702 code on the owner EOA (deployer pays this gas) ────────
  const ownerCode = await publicClient.getCode({
    address: ownerAccount.address,
  });
  const alreadyDelegated = ownerCode?.startsWith("0xef0100");

  if (!alreadyDelegated) {
    console.log("\n[2] Signing EIP-7702 authorization...");
    const ownerNonce = await publicClient.getTransactionCount({
      address: ownerAccount.address,
    });

    const authorization = await ownerWallet.signAuthorization({
      contractAddress: implementation7702,
      nonce: ownerNonce,
    });

    const authTxHash = await deployerWallet.sendTransaction({
      to: ownerAccount.address,
      data: "0x",
      authorizationList: [authorization],
    });
    await publicClient.waitForTransactionReceipt({ hash: authTxHash });
    console.log("    EOA delegated to smart account  tx:", authTxHash);
  } else {
    console.log("\n[2] EOA already delegated — skipping");
  }

  // ── 3. Gas parameters ─────────────────────────────────────────────────────
  const { maxFeePerGas, maxPriorityFeePerGas } =
    await publicClient.estimateFeesPerGas();
  const gasFeesBytes = pack128(
    maxPriorityFeePerGas ?? parseGwei("2"),
    maxFeePerGas ?? parseGwei("20"),
  );

  // paymasterAndData: paymaster(20) | pmVerifGas(16) | pmPostOpGas(16)
  const paymasterAndData = concat([
    PAYMASTER_ADDR,
    pad(toHex(200_000n), { size: 16 }), // paymasterVerificationGasLimit
    pad(toHex(50_000n), { size: 16 }), // paymasterPostOpGasLimit
  ]) as `0x${string}`;

  // ── 4. UserOp helper ──────────────────────────────────────────────────────
  async function runUserOp(storageCalldata: `0x${string}`, step: string) {
    const nonce = (await publicClient.readContract({
      address: ENTRY_POINT,
      abi: entryPointAbi,
      functionName: "getNonce",
      args: [ownerAccount.address, 0n],
    })) as bigint;

    // Calldata: EIP7702Implementation.execute → Storage.<fn>
    const callData = encodeFunctionData({
      abi: implAbi,
      functionName: "execute",
      args: [STORAGE_ADDR, 0n, storageCalldata],
    });

    const op: PackedUserOp = {
      sender: ownerAccount.address,
      nonce,
      initCode: "0x",
      callData,
      accountGasLimits: pack128(300_000n, 150_000n), // verifyGas | callGas
      preVerificationGas: 60_000n,
      gasFees: gasFeesBytes,
      paymasterAndData,
      signature: "0x",
    };

    // Sign the raw userOpHash — SignerEIP7702 uses ECDSA without prefix
    const userOpHash = getUserOpHash(op, sepolia.id);
    op.signature = await ownerAccount.sign({ hash: userOpHash });

    console.log(`\n[${step}] Sending UserOp  nonce=${nonce}`);
    const txHash = await deployerWallet.writeContract({
      address: ENTRY_POINT,
      abi: entryPointAbi,
      functionName: "handleOps",
      args: [[op], deployerAccount.address],
    });
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });
    console.log(`    tx: ${txHash}  status: ${receipt.status}`);
    return receipt;
  }

  // ── CREATE ─────────────────────────────────────────────────────────────────
  await runUserOp(
    encodeFunctionData({
      abi: storageAbi,
      functionName: "create",
      args: ["Hello via EIP-7702!"],
    }),
    "CREATE",
  );
  const count = await publicClient.readContract({
    address: STORAGE_ADDR,
    abi: storageAbi,
    functionName: "getItemCount",
  });
  console.log("    Item count:", count);

  // ── UPDATE ─────────────────────────────────────────────────────────────────
  await runUserOp(
    encodeFunctionData({
      abi: storageAbi,
      functionName: "update",
      args: [1n, "Updated via EIP-7702!"],
    }),
    "UPDATE",
  );

  // ── DELETE ─────────────────────────────────────────────────────────────────
  // await runUserOp(
  //   encodeFunctionData({ abi: storageAbi, functionName: "remove", args: [1n] }),
  //   "DELETE"
  // );
  // const exists = await publicClient.readContract({ address: STORAGE_ADDR, abi: storageAbi, functionName: "exists", args: [1n] });
  // console.log("    Item exists after delete:", exists);

  // console.log("\nAll CRUD ops complete — gas sponsored by RegistryPaymaster ✓");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
