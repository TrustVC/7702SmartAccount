import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import hre from "hardhat";

chai.use(chaiAsPromised);
import { getAddress, parseEther, zeroAddress } from "viem";

describe("PlatformAccountFactory", function () {
  async function deployFixture() {
    const [owner, platform, other] = await hre.viem.getWalletClients();

    const mockEntryPoint = await hre.viem.deployContract("MockEntryPoint");
    const mockTdocDeployer = await hre.viem.deployContract("MockTdocDeployer");
    const impl = await hre.viem.deployContract("PlatformPaymaster", [
      mockEntryPoint.address,
    ]);
    const factory = await hre.viem.deployContract("PlatformAccountFactory", [
      mockTdocDeployer.address,
      impl.address,
    ]);

    const publicClient = await hre.viem.getPublicClient();

    return {
      factory,
      impl,
      mockEntryPoint,
      mockTdocDeployer,
      owner,
      platform,
      other,
      publicClient,
    };
  }

  type FixtureResult = Awaited<ReturnType<typeof deployFixture>>;

  // Helper: deploy a clone through the factory and return its address.
  async function deployClone(
    factory: FixtureResult["factory"],
    platform: FixtureResult["platform"],
    salt: `0x${string}` = `0x${"aa".repeat(32)}`,
    dailyLimit = parseEther("1"),
  ) {
    await factory.write.deployPlatformPaymaster([
      platform.account.address,
      dailyLimit,
      salt,
    ]);
    const events = await factory.getEvents.PlatformOnboarded();
    return events[events.length - 1].args.paymaster as `0x${string}`;
  }

  // ─── Deployment ────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("sets tdocDeployer", async function () {
      const { factory, mockTdocDeployer } = await loadFixture(deployFixture);
      expect(await factory.read.tdocDeployer()).to.equal(
        getAddress(mockTdocDeployer.address),
      );
    });

    it("sets paymasterImplementation", async function () {
      const { factory, impl } = await loadFixture(deployFixture);
      expect(await factory.read.paymasterImplementation()).to.equal(
        getAddress(impl.address),
      );
    });

    it("sets owner to deployer", async function () {
      const { factory, owner } = await loadFixture(deployFixture);
      expect(await factory.read.owner()).to.equal(
        getAddress(owner.account.address),
      );
    });
  });

  // ─── updateTdocDeployer ────────────────────────────────────────────────────

  describe("updateTdocDeployer", function () {
    it("owner can update", async function () {
      const { factory, other } = await loadFixture(deployFixture);
      await factory.write.updateTdocDeployer([other.account.address]);
      expect(await factory.read.tdocDeployer()).to.equal(
        getAddress(other.account.address),
      );
    });

    it("emits TdocDeployerUpdated", async function () {
      const { factory, other, publicClient } = await loadFixture(deployFixture);
      const hash = await factory.write.updateTdocDeployer([
        other.account.address,
      ]);
      await publicClient.waitForTransactionReceipt({ hash });
      const events = await factory.getEvents.TdocDeployerUpdated();
      expect(events).to.have.lengthOf(1);
      expect(events[0].args.newDeployer).to.equal(
        getAddress(other.account.address),
      );
    });

    it("reverts for non-owner", async function () {
      const { factory, other } = await loadFixture(deployFixture);
      const factoryAsOther = await hre.viem.getContractAt(
        "PlatformAccountFactory",
        factory.address,
        { client: { wallet: other } },
      );
      await expect(
        factoryAsOther.write.updateTdocDeployer([other.account.address]),
      ).to.be.rejectedWith("OwnableUnauthorizedAccount");
    });

    it("reverts for zero address", async function () {
      const { factory } = await loadFixture(deployFixture);
      await expect(
        factory.write.updateTdocDeployer([zeroAddress]),
      ).to.be.rejectedWith("Zero address");
    });
  });

  // ─── updatePaymasterImplementation ────────────────────────────────────────

  describe("updatePaymasterImplementation", function () {
    it("owner can update", async function () {
      const { factory, other } = await loadFixture(deployFixture);
      await factory.write.updatePaymasterImplementation([
        other.account.address,
      ]);
      expect(await factory.read.paymasterImplementation()).to.equal(
        getAddress(other.account.address),
      );
    });

    it("emits ImplementationUpdated", async function () {
      const { factory, other, publicClient } = await loadFixture(deployFixture);
      const hash = await factory.write.updatePaymasterImplementation([
        other.account.address,
      ]);
      await publicClient.waitForTransactionReceipt({ hash });
      const events = await factory.getEvents.ImplementationUpdated();
      expect(events).to.have.lengthOf(1);
      expect(events[0].args.newImplementation).to.equal(
        getAddress(other.account.address),
      );
    });

    it("reverts for non-owner", async function () {
      const { factory, other } = await loadFixture(deployFixture);
      const factoryAsOther = await hre.viem.getContractAt(
        "PlatformAccountFactory",
        factory.address,
        { client: { wallet: other } },
      );
      await expect(
        factoryAsOther.write.updatePaymasterImplementation([
          other.account.address,
        ]),
      ).to.be.rejectedWith("OwnableUnauthorizedAccount");
    });

    it("reverts for zero address", async function () {
      const { factory } = await loadFixture(deployFixture);
      await expect(
        factory.write.updatePaymasterImplementation([zeroAddress]),
      ).to.be.rejectedWith("Zero address");
    });
  });

  // ─── deployPlatformPaymaster ───────────────────────────────────────────────

  describe("deployPlatformPaymaster", function () {
    it("emits PlatformOnboarded with clone address", async function () {
      const { factory, platform } = await loadFixture(deployFixture);
      await deployClone(factory, platform);
      const events = await factory.getEvents.PlatformOnboarded();
      expect(events).to.have.lengthOf(1);
      expect(events[0].args.platformAddress).to.equal(
        getAddress(platform.account.address),
      );
    });

    it("clone owner is platformAddress", async function () {
      const { factory, platform, mockTdocDeployer } =
        await loadFixture(deployFixture);
      const cloneAddr = await deployClone(factory, platform);
      const clone = await hre.viem.getContractAt(
        "PlatformPaymaster",
        cloneAddr,
      );
      expect(await clone.read.owner()).to.equal(
        getAddress(platform.account.address),
      );
    });

    it("clone dailyLimit is set correctly", async function () {
      const { factory, platform } = await loadFixture(deployFixture);
      const limit = parseEther("2.5");
      const cloneAddr = await deployClone(
        factory,
        platform,
        `0x${"bb".repeat(32)}`,
        limit,
      );
      const clone = await hre.viem.getContractAt(
        "PlatformPaymaster",
        cloneAddr,
      );
      expect(await clone.read.dailyLimit()).to.equal(limit);
    });

    it("clone tdocDeployer matches factory tdocDeployer", async function () {
      const { factory, platform, mockTdocDeployer } =
        await loadFixture(deployFixture);
      const cloneAddr = await deployClone(factory, platform);
      const clone = await hre.viem.getContractAt(
        "PlatformPaymaster",
        cloneAddr,
      );
      expect(await clone.read.tdocDeployer()).to.equal(
        getAddress(mockTdocDeployer.address),
      );
    });

    it("computePaymasterAddress predicts the deployed address", async function () {
      const { factory, platform } = await loadFixture(deployFixture);
      const salt = `0x${"cc".repeat(32)}` as `0x${string}`;
      const predicted = await factory.read.computePaymasterAddress([salt]);
      const cloneAddr = await deployClone(factory, platform, salt);
      expect(cloneAddr.toLowerCase()).to.equal(predicted.toLowerCase());
    });

    it("clone cannot be re-initialized", async function () {
      const { factory, platform, other } = await loadFixture(deployFixture);
      const cloneAddr = await deployClone(factory, platform);
      const clone = await hre.viem.getContractAt(
        "PlatformPaymaster",
        cloneAddr,
      );
      await expect(
        clone.write.initialize([
          other.account.address,
          0n,
          other.account.address,
        ]),
      ).to.be.rejectedWith("Already initialized");
    });

    it("same salt reverts on second deploy", async function () {
      const { factory, platform } = await loadFixture(deployFixture);
      const salt = `0x${"dd".repeat(32)}` as `0x${string}`;
      await factory.write.deployPlatformPaymaster([
        platform.account.address,
        0n,
        salt,
      ]);
      await expect(
        factory.write.deployPlatformPaymaster([
          platform.account.address,
          0n,
          salt,
        ]),
      ).to.be.rejected;
    });
  });
});
