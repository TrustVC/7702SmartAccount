import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseEther, toHex } from "viem";

describe("EIP-7702 End-to-End Flow", function () {
  /**
   * Full deployment fixture:
   *  1. Deploy EntryPoint
   *  2. Deploy ClientAccountFactory (also deploys EIP7702Implementation internally)
   *  3. Deploy Storage as the client registry
   *  4. Use factory to deploy RegistryPaymaster
   */
  async function deployFullFlowFixture() {
    const [clientAccount, beneficiaryAccount, holderAccount] =
      await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();

    // Step 1: Deploy EntryPoint (ERC-4337)
    const entryPoint = await hre.viem.deployContract("EntryPoint");

    // Step 2: Deploy Factory — constructor also deploys EIP7702Implementation
    const factory = await hre.viem.deployContract("ClientAccountFactory", [
      entryPoint.address,
    ]);
    const implementation7702Address = await factory.read.implementation7702();

    // Step 3: Deploy Storage (acts as IClientRegistry: exposes beneficiary/holder)
    const storage = await hre.viem.deployContract("Storage", [
      beneficiaryAccount.account.address,
      holderAccount.account.address,
    ]);

    // Step 4: Deploy RegistryPaymaster via factory
    const dailyLimit = parseEther("1"); // 1 ETH daily spend cap
    const salt = toHex(1n, { size: 32 });

    const deployPaymasterTx = await factory.write.deployClientPaymaster([
      clientAccount.account.address,
      storage.address,
      dailyLimit,
      salt,
    ]);
    await publicClient.waitForTransactionReceipt({ hash: deployPaymasterTx });

    const onboardedEvents = await factory.getEvents.ClientOnboarded();
    const paymasterAddress = getAddress(onboardedEvents[0].args.paymaster!);

    const paymaster = await hre.viem.getContractAt(
      "RegistryPaymaster",
      paymasterAddress
    );

    return {
      entryPoint,
      factory,
      implementation7702Address,
      storage,
      paymaster,
      paymasterAddress,
      clientAccount,
      beneficiaryAccount,
      holderAccount,
      dailyLimit,
      publicClient,
    };
  }

  describe("Full flow: factory → paymaster → top-up → CRUD", function () {
    it("deploys factory and verifies EntryPoint + EIP7702Implementation wired correctly", async function () {
      const { entryPoint, factory, implementation7702Address } =
        await loadFixture(deployFullFlowFixture);

      expect(await factory.read.entryPoint()).to.equal(
        getAddress(entryPoint.address)
      );
      expect(implementation7702Address).to.not.equal(
        "0x0000000000000000000000000000000000000000"
      );
    });

    it("deploys paymaster via factory with correct registry and daily limit", async function () {
      const {
        storage,
        paymaster,
        beneficiaryAccount,
        holderAccount,
        dailyLimit,
      } = await loadFixture(deployFullFlowFixture);

      expect(await paymaster.read.dailyLimit()).to.equal(dailyLimit);
      expect(await paymaster.read.clientRegistry()).to.equal(
        getAddress(storage.address)
      );

      const [allowedBeneficiary, allowedHolder] =
        await paymaster.read.getAllowedAddresses();
      expect(allowedBeneficiary).to.equal(
        getAddress(beneficiaryAccount.account.address)
      );
      expect(allowedHolder).to.equal(
        getAddress(holderAccount.account.address)
      );
    });

    it("tops up paymaster and registers deposit in EntryPoint", async function () {
      const { entryPoint, clientAccount, paymasterAddress, publicClient } =
        await loadFixture(deployFullFlowFixture);

      const topUpAmount = parseEther("0.5");
      const topUpTx = await clientAccount.sendTransaction({
        to: paymasterAddress,
        value: topUpAmount,
      });
      await publicClient.waitForTransactionReceipt({ hash: topUpTx });

      // receive() on paymaster forwards ETH to entryPoint.depositTo()
      const depositBalance = await entryPoint.read.balanceOf([paymasterAddress]);
      expect(depositBalance).to.equal(topUpAmount);
    });

    it("executes a Storage create() CRUD operation as the beneficiary", async function () {
      const { storage, beneficiaryAccount, publicClient } =
        await loadFixture(deployFullFlowFixture);

      const storageAsBeneficiary = await hre.viem.getContractAt(
        "Storage",
        storage.address,
        { client: { wallet: beneficiaryAccount } }
      );

      const createTx = await storageAsBeneficiary.write.create([
        "Hello EIP-7702",
      ]);
      await publicClient.waitForTransactionReceipt({ hash: createTx });

      expect(await storage.read.getItemCount()).to.equal(1n);
      expect(await storage.read.exists([1n])).to.equal(true);

      const createdEvents = await storage.getEvents.ItemCreated();
      expect(createdEvents).to.have.lengthOf(1);
      expect(createdEvents[0].args.id).to.equal(1n);
      expect(createdEvents[0].args.data).to.equal("Hello EIP-7702");
    });

    it("runs the complete end-to-end flow in sequence", async function () {
      const {
        entryPoint,
        factory,
        implementation7702Address,
        storage,
        paymaster,
        paymasterAddress,
        clientAccount,
        beneficiaryAccount,
        holderAccount,
        dailyLimit,
        publicClient,
      } = await loadFixture(deployFullFlowFixture);

      // ── 1. Factory state ───────────────────────────────────────────────────
      expect(await factory.read.entryPoint()).to.equal(
        getAddress(entryPoint.address)
      );
      expect(implementation7702Address).to.not.equal(
        "0x0000000000000000000000000000000000000000"
      );

      // ── 2. Paymaster linked to registry and client ─────────────────────────
      expect(await paymaster.read.dailyLimit()).to.equal(dailyLimit);
      expect(await paymaster.read.clientRegistry()).to.equal(
        getAddress(storage.address)
      );

      const [allowedBeneficiary, allowedHolder] =
        await paymaster.read.getAllowedAddresses();
      expect(allowedBeneficiary).to.equal(
        getAddress(beneficiaryAccount.account.address)
      );
      expect(allowedHolder).to.equal(
        getAddress(holderAccount.account.address)
      );

      // ── 3. Top up paymaster ────────────────────────────────────────────────
      const topUpAmount = parseEther("0.5");
      const topUpTx = await clientAccount.sendTransaction({
        to: paymasterAddress,
        value: topUpAmount,
      });
      await publicClient.waitForTransactionReceipt({ hash: topUpTx });

      const depositBalance = await entryPoint.read.balanceOf([paymasterAddress]);
      expect(depositBalance).to.equal(topUpAmount);

      // ── 4. CRUD: create item as beneficiary ────────────────────────────────
      const storageAsBeneficiary = await hre.viem.getContractAt(
        "Storage",
        storage.address,
        { client: { wallet: beneficiaryAccount } }
      );

      const createTx = await storageAsBeneficiary.write.create([
        "Hello EIP-7702",
      ]);
      await publicClient.waitForTransactionReceipt({ hash: createTx });

      expect(await storage.read.getItemCount()).to.equal(1n);
      expect(await storage.read.exists([1n])).to.equal(true);

      const createdEvents = await storage.getEvents.ItemCreated();
      expect(createdEvents).to.have.lengthOf(1);
      expect(createdEvents[0].args.id).to.equal(1n);
      expect(createdEvents[0].args.data).to.equal("Hello EIP-7702");
    });
  });
});
