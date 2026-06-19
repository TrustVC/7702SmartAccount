import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import {
  getAddress,
  parseEther,
  encodeFunctionData,
  parseAbi,
  concat,
  pad,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Hardhat default account index 1 — used as beneficiary/holder (signs UserOps)
const OWNER_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as `0x${string}`;
const ownerAccount = privateKeyToAccount(OWNER_PRIVATE_KEY);

// ── ABIs ─────────────────────────────────────────────────────────────────────
const implAbi = parseAbi([
  "function execute(address to, uint256 value, bytes calldata data) external returns (bytes memory)",
]);

const storageAbi = parseAbi([
  "function create(string memory _data) external returns (uint)",
  "function update(uint _id, string memory _newData) external",
  "function remove(uint _id) external",
]);

const entryPointAbi = parseAbi([
  "function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops, address payable beneficiary) external",
  "function getNonce(address sender, uint192 key) external view returns (uint256)",
  "function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) external view returns (bytes32)",
  "function balanceOf(address account) external view returns (uint256)",
]);

// ── Helpers ───────────────────────────────────────────────────────────────────
function pack128(hi: bigint, lo: bigint): `0x${string}` {
  return concat([
    pad(toHex(hi), { size: 16 }),
    pad(toHex(lo), { size: 16 }),
  ]) as `0x${string}`;
}

// ── Fixture ───────────────────────────────────────────────────────────────────
async function deployV2Fixture() {
  const [deployerWallet] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();

  // 1. EntryPoint
  const entryPoint = await hre.viem.deployContract("EntryPoint");

  // 2. Factory — also deploys EIP7702Implementation with correct EntryPoint
  const factory = await hre.viem.deployContract("ClientAccountFactory", [
    entryPoint.address,
  ]);
  const implementation7702Address =
    (await factory.read.implementation7702()) as `0x${string}`;

  // 3. Storage — owner is our test EOA
  const storage = await hre.viem.deployContract("Storage", [
    ownerAccount.address, // beneficiary
    ownerAccount.address, // holder
  ]);

  // 4. PaymasterV2 — validates callData target, no third-party storage reads
  const dailyLimit = parseEther("1");
  const paymasterV2 = await hre.viem.deployContract("PaymasterV2", [
    entryPoint.address,
    deployerWallet.account.address,
    storage.address,
    dailyLimit,
  ]);

  // 5. Top up paymaster
  await publicClient.waitForTransactionReceipt({
    hash: await deployerWallet.sendTransaction({
      to: paymasterV2.address,
      value: parseEther("2"),
    }),
  });

  // 6. Simulate EIP-7702 delegation via hardhat_setCode
  //    Copy EIP7702Implementation runtime bytecode to the owner EOA's address.
  //    This is exactly what EIP-7702 does on a Prague-capable chain.
  const implCode = await publicClient.getCode({
    address: implementation7702Address,
  });
  await hre.network.provider.send("hardhat_setCode", [
    ownerAccount.address,
    implCode,
  ]);

  return {
    entryPoint,
    factory,
    implementation7702Address,
    storage,
    paymasterV2,
    deployerWallet,
    publicClient,
    dailyLimit,
  };
}

// ── UserOp builder ────────────────────────────────────────────────────────────
async function sendUserOp(
  storageCalldata: `0x${string}`,
  fixture: Awaited<ReturnType<typeof deployV2Fixture>>
) {
  const { entryPoint, storage, paymasterV2, deployerWallet, publicClient } =
    fixture;

  const nonce = await publicClient.readContract({
    address: entryPoint.address,
    abi: entryPointAbi,
    functionName: "getNonce",
    args: [ownerAccount.address, 0n],
  });

  const callData = encodeFunctionData({
    abi: implAbi,
    functionName: "execute",
    args: [storage.address, 0n, storageCalldata],
  });

  const paymasterAndData = concat([
    paymasterV2.address,
    pad(toHex(200_000n), { size: 16 }),
    pad(toHex(50_000n), { size: 16 }),
  ]) as `0x${string}`;

  const userOp = {
    sender:             ownerAccount.address,
    nonce,
    initCode:           "0x" as `0x${string}`,
    callData,
    accountGasLimits:   pack128(300_000n, 200_000n),
    preVerificationGas: 60_000n,
    gasFees:            pack128(2_000_000_000n, 20_000_000_000n),
    paymasterAndData,
    signature:          "0x" as `0x${string}`,
  };

  // Get hash directly from EntryPoint to avoid any formula mismatch
  const userOpHash = await publicClient.readContract({
    address: entryPoint.address,
    abi: entryPointAbi,
    functionName: "getUserOpHash",
    args: [userOp],
  }) as `0x${string}`;

  // Sign raw hash — SignerEIP7702 uses ECDSA without prefix
  userOp.signature = await ownerAccount.sign({ hash: userOpHash });

  const tx = await deployerWallet.writeContract({
    address: entryPoint.address,
    abi: entryPointAbi,
    functionName: "handleOps",
    args: [[userOp], deployerWallet.account.address],
  });

  return publicClient.waitForTransactionReceipt({ hash: tx });
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("EIP-7702 Flow V2 — PaymasterV2", function () {

  describe("Deployment & configuration", function () {
    it("wires authorizedRegistry to Storage contract", async function () {
      const { storage, paymasterV2 } = await loadFixture(deployV2Fixture);
      expect(await paymasterV2.read.authorizedRegistry()).to.equal(
        getAddress(storage.address)
      );
    });

    it("sets daily limit correctly", async function () {
      const { paymasterV2, dailyLimit } = await loadFixture(deployV2Fixture);
      expect(await paymasterV2.read.dailyLimit()).to.equal(dailyLimit);
    });

    it("receive() deposits ETH into EntryPoint", async function () {
      const { entryPoint, paymasterV2 } = await loadFixture(deployV2Fixture);
      const balance = await publicClientBalanceOf(entryPoint.address, paymasterV2.address);
      expect(balance).to.equal(parseEther("2"));
    });
  });

  describe("EIP-7702 delegation simulation", function () {
    it("owner EOA has implementation code set via hardhat_setCode", async function () {
      const { implementation7702Address } = await loadFixture(deployV2Fixture);
      const publicClient = await hre.viem.getPublicClient();
      const ownerCode = await publicClient.getCode({ address: ownerAccount.address });
      const implCode  = await publicClient.getCode({ address: implementation7702Address });
      expect(ownerCode).to.equal(implCode);
    });
  });

  describe("PaymasterV2 callData validation", function () {
    it("rejects UserOp with wrong function selector", async function () {
      const fixture = await loadFixture(deployV2Fixture);
      // Use wrong selector: update() instead of execute()
      const badCallData = encodeFunctionData({
        abi: storageAbi,
        functionName: "create",
        args: ["bad"],
      });
      // callData directly as update() — not wrapped in execute() — wrong selector
      let threw = false;
      try { await sendUserOpWithCallData(badCallData, fixture); } catch { threw = true; }
      expect(threw).to.equal(true);
    });

    it("rejects UserOp targeting a different contract", async function () {
      const fixture = await loadFixture(deployV2Fixture);
      const wrongTarget = fixture.factory.address; // not the authorized registry
      const callData = encodeFunctionData({
        abi: implAbi,
        functionName: "execute",
        args: [wrongTarget, 0n, "0x"],
      });
      let threw = false;
      try { await sendUserOpWithRawCallData(callData, fixture); } catch { threw = true; }
      expect(threw).to.equal(true);
    });

    it("approves UserOp targeting authorizedRegistry", async function () {
      const fixture = await loadFixture(deployV2Fixture);
      const receipt = await sendUserOp(
        encodeFunctionData({ abi: storageAbi, functionName: "create", args: ["validation test"] }),
        fixture
      );
      expect(receipt.status).to.equal("success");
    });
  });

  describe("Full CRUD via UserOps — gas sponsored by PaymasterV2", function () {
    it("CREATE — beneficiary creates item, paymaster covers gas", async function () {
      const fixture = await loadFixture(deployV2Fixture);
      const { storage } = fixture;

      const receipt = await sendUserOp(
        encodeFunctionData({ abi: storageAbi, functionName: "create", args: ["Hello PaymasterV2!"] }),
        fixture
      );

      expect(receipt.status).to.equal("success");
      expect(await storage.read.getItemCount()).to.equal(1n);
      expect(await storage.read.exists([1n])).to.equal(true);

      const events = await storage.getEvents.ItemCreated();
      expect(events[0].args.data).to.equal("Hello PaymasterV2!");
    });

    it("UPDATE — updates existing item", async function () {
      const fixture = await loadFixture(deployV2Fixture);

      // Create first
      await sendUserOp(
        encodeFunctionData({ abi: storageAbi, functionName: "create", args: ["original"] }),
        fixture
      );

      // Update
      const receipt = await sendUserOp(
        encodeFunctionData({ abi: storageAbi, functionName: "update", args: [1n, "updated!"] }),
        fixture
      );

      expect(receipt.status).to.equal("success");
      const events = await fixture.storage.getEvents.ItemUpdated();
      expect(events[0].args.data).to.equal("updated!");
    });

    it("DELETE — removes existing item", async function () {
      const fixture = await loadFixture(deployV2Fixture);

      // Create then delete
      await sendUserOp(
        encodeFunctionData({ abi: storageAbi, functionName: "create", args: ["to be deleted"] }),
        fixture
      );
      const receipt = await sendUserOp(
        encodeFunctionData({ abi: storageAbi, functionName: "remove", args: [1n] }),
        fixture
      );

      expect(receipt.status).to.equal("success");
      expect(await fixture.storage.read.exists([1n])).to.equal(false);
    });

    it("daily spend is tracked after sponsored ops", async function () {
      const fixture = await loadFixture(deployV2Fixture);

      await sendUserOp(
        encodeFunctionData({ abi: storageAbi, functionName: "create", args: ["spend tracking test"] }),
        fixture
      );

      const [spent] = await fixture.paymasterV2.read.getUserDailySpend([ownerAccount.address]);
      expect(spent > 0n).to.equal(true);
    });

    it("paymaster deposit decreases after sponsoring ops", async function () {
      const fixture = await loadFixture(deployV2Fixture);
      const { entryPoint, paymasterV2 } = fixture;

      const before = await publicClientBalanceOf(entryPoint.address, paymasterV2.address);
      await sendUserOp(
        encodeFunctionData({ abi: storageAbi, functionName: "create", args: ["deposit check"] }),
        fixture
      );
      const after = await publicClientBalanceOf(entryPoint.address, paymasterV2.address);

      expect(after < before).to.equal(true);
    });
  });
});

// ── Internal helpers ──────────────────────────────────────────────────────────

async function publicClientBalanceOf(entryPointAddr: `0x${string}`, target: `0x${string}`) {
  const publicClient = await hre.viem.getPublicClient();
  return publicClient.readContract({
    address: entryPointAddr,
    abi: entryPointAbi,
    functionName: "balanceOf",
    args: [target],
  }) as Promise<bigint>;
}

// Sends a UserOp with raw callData (wrong selector test)
async function sendUserOpWithCallData(
  callData: `0x${string}`,
  fixture: Awaited<ReturnType<typeof deployV2Fixture>>
) {
  return sendUserOpWithRawCallData(callData, fixture);
}

async function sendUserOpWithRawCallData(
  callData: `0x${string}`,
  fixture: Awaited<ReturnType<typeof deployV2Fixture>>
) {
  const { entryPoint, paymasterV2, deployerWallet, publicClient } = fixture;

  const nonce = await publicClient.readContract({
    address: entryPoint.address,
    abi: entryPointAbi,
    functionName: "getNonce",
    args: [ownerAccount.address, 0n],
  });

  const paymasterAndData = concat([
    paymasterV2.address,
    pad(toHex(200_000n), { size: 16 }),
    pad(toHex(50_000n), { size: 16 }),
  ]) as `0x${string}`;

  const userOp = {
    sender:             ownerAccount.address,
    nonce,
    initCode:           "0x" as `0x${string}`,
    callData,
    accountGasLimits:   pack128(300_000n, 200_000n),
    preVerificationGas: 60_000n,
    gasFees:            pack128(2_000_000_000n, 20_000_000_000n),
    paymasterAndData,
    signature:          "0x" as `0x${string}`,
  };

  const userOpHash = await publicClient.readContract({
    address: entryPoint.address,
    abi: entryPointAbi,
    functionName: "getUserOpHash",
    args: [userOp],
  }) as `0x${string}`;

  userOp.signature = await ownerAccount.sign({ hash: userOpHash });

  const tx = await deployerWallet.writeContract({
    address: entryPoint.address,
    abi: entryPointAbi,
    functionName: "handleOps",
    args: [[userOp], deployerWallet.account.address],
  });

  return publicClient.waitForTransactionReceipt({ hash: tx });
}
