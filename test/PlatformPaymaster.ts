import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import hre from "hardhat";

chai.use(chaiAsPromised);
import { getAddress, parseEther, zeroAddress } from "viem";

describe("PlatformPaymaster", function () {
  async function deployFixture() {
    const [owner, platform, user, other] = await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();

    const mockEntryPoint = await hre.viem.deployContract("MockEntryPoint");
    const mockTdocDeployer = await hre.viem.deployContract("MockTdocDeployer");
    const impl = await hre.viem.deployContract("PlatformPaymaster", [
      mockEntryPoint.address,
    ]);
    const factory = await hre.viem.deployContract("PlatformAccountFactory", [
      mockTdocDeployer.address,
      impl.address,
    ]);

    // Deploy one clone owned by `platform`
    const salt = `0x${"00".repeat(32)}` as `0x${string}`;
    await factory.write.deployPlatformPaymaster([
      platform.account.address,
      parseEther("1"),
      salt,
    ]);
    const events = await factory.getEvents.PlatformOnboarded();
    const cloneAddr = events[0].args.paymaster as `0x${string}`;

    // Convenience: clone connected to platform wallet (owner) and other wallet
    const paymaster = await hre.viem.getContractAt("PlatformPaymaster", cloneAddr, {
      client: { wallet: platform },
    });
    const paymasterAsOther = await hre.viem.getContractAt("PlatformPaymaster", cloneAddr, {
      client: { wallet: other },
    });

    // A standalone MockRegistry for mintDocument tests
    const mockRegistry = await hre.viem.deployContract("MockRegistry", [
      cloneAddr, // initial admin = paymaster (mirrors real deployRegistry flow)
    ]);

    return {
      paymaster,
      paymasterAsOther,
      impl,
      mockEntryPoint,
      mockTdocDeployer,
      mockRegistry,
      owner,
      platform,
      user,
      other,
      publicClient,
    };
  }

  // ─── Initialize ────────────────────────────────────────────────────────────

  describe("initialize", function () {
    it("sets owner, dailyLimit, tdocDeployer correctly", async function () {
      const { paymaster, platform, mockTdocDeployer } = await loadFixture(deployFixture);
      expect(await paymaster.read.owner()).to.equal(getAddress(platform.account.address));
      expect(await paymaster.read.dailyLimit()).to.equal(parseEther("1"));
      expect(await paymaster.read.tdocDeployer()).to.equal(getAddress(mockTdocDeployer.address));
    });

    it("blocks re-initialization on clone", async function () {
      const { paymaster, other } = await loadFixture(deployFixture);
      await expect(
        paymaster.write.initialize([other.account.address, 0n, other.account.address]),
      ).to.be.rejectedWith("Already initialized");
    });

    it("blocks initialization on the implementation itself", async function () {
      const { impl, other } = await loadFixture(deployFixture);
      await expect(
        impl.write.initialize([other.account.address, 0n, other.account.address]),
      ).to.be.rejectedWith("Already initialized");
    });

    it("reverts if owner is zero", async function () {
      const { impl, mockTdocDeployer, mockEntryPoint } = await loadFixture(deployFixture);
      // Deploy a fresh impl and clone without the factory to test directly
      const freshImpl = await hre.viem.deployContract("PlatformPaymaster", [
        mockEntryPoint.address,
      ]);
      // Call initialize directly via a raw clone — easier to just test via factory with zero address
      // The factory validates non-zero owner via initialize's require
      const factory2 = await hre.viem.deployContract("PlatformAccountFactory", [
        mockTdocDeployer.address,
        freshImpl.address,
      ]);
      await expect(
        factory2.write.deployPlatformPaymaster([
          zeroAddress,
          0n,
          `0x${"ff".repeat(32)}` as `0x${string}`,
        ]),
      ).to.be.rejectedWith("Zero owner");
    });
  });

  // ─── setUserWhitelist ──────────────────────────────────────────────────────

  describe("setUserWhitelist", function () {
    it("owner sets credits", async function () {
      const { paymaster, user } = await loadFixture(deployFixture);
      await paymaster.write.setUserWhitelist([user.account.address, 2n]);
      expect(await paymaster.read.userWhitelist([user.account.address])).to.equal(2n);
    });

    it("reverts if credits > 3", async function () {
      const { paymaster, user } = await loadFixture(deployFixture);
      await expect(
        paymaster.write.setUserWhitelist([user.account.address, 4n]),
      ).to.be.rejectedWith("Exceeds max credits of 3");
    });

    it("reverts for zero address", async function () {
      const { paymaster } = await loadFixture(deployFixture);
      await expect(
        paymaster.write.setUserWhitelist([zeroAddress, 1n]),
      ).to.be.rejectedWith("Zero address");
    });

    it("reverts for non-owner", async function () {
      const { paymasterAsOther, user } = await loadFixture(deployFixture);
      await expect(
        paymasterAsOther.write.setUserWhitelist([user.account.address, 1n]),
      ).to.be.rejectedWith("OwnableUnauthorizedAccount");
    });
  });

  // ─── removeUserFromWhitelist ───────────────────────────────────────────────

  describe("removeUserFromWhitelist", function () {
    it("zeros out credits", async function () {
      const { paymaster, user } = await loadFixture(deployFixture);
      await paymaster.write.setUserWhitelist([user.account.address, 3n]);
      await paymaster.write.removeUserFromWhitelist([user.account.address]);
      expect(await paymaster.read.userWhitelist([user.account.address])).to.equal(0n);
    });

    it("reverts for non-owner", async function () {
      const { paymasterAsOther, user } = await loadFixture(deployFixture);
      await expect(
        paymasterAsOther.write.removeUserFromWhitelist([user.account.address]),
      ).to.be.rejectedWith("OwnableUnauthorizedAccount");
    });
  });

  // ─── addRegistry / removeRegistry ─────────────────────────────────────────

  describe("addRegistry / removeRegistry", function () {
    it("owner adds and removes a registry", async function () {
      const { paymaster, other } = await loadFixture(deployFixture);
      await paymaster.write.addRegistry([other.account.address]);
      expect(await paymaster.read.authorizedRegistries([other.account.address])).to.be.true;

      await paymaster.write.removeRegistry([other.account.address]);
      expect(await paymaster.read.authorizedRegistries([other.account.address])).to.be.false;
    });

    it("reverts addRegistry for non-owner", async function () {
      const { paymasterAsOther, other } = await loadFixture(deployFixture);
      await expect(
        paymasterAsOther.write.addRegistry([other.account.address]),
      ).to.be.rejectedWith("OwnableUnauthorizedAccount");
    });

    it("reverts addRegistry for zero address", async function () {
      const { paymaster } = await loadFixture(deployFixture);
      await expect(paymaster.write.addRegistry([zeroAddress])).to.be.rejectedWith("Zero address");
    });
  });

  // ─── addTitleEscrow / removeTitleEscrow ───────────────────────────────────

  describe("addTitleEscrow / removeTitleEscrow", function () {
    it("owner adds and removes a title escrow", async function () {
      const { paymaster, other } = await loadFixture(deployFixture);
      await paymaster.write.addTitleEscrow([other.account.address]);
      expect(await paymaster.read.authorizedTitleEscrows([other.account.address])).to.be.true;

      await paymaster.write.removeTitleEscrow([other.account.address]);
      expect(await paymaster.read.authorizedTitleEscrows([other.account.address])).to.be.false;
    });

    it("reverts for non-owner", async function () {
      const { paymasterAsOther, other } = await loadFixture(deployFixture);
      await expect(
        paymasterAsOther.write.addTitleEscrow([other.account.address]),
      ).to.be.rejectedWith("OwnableUnauthorizedAccount");
    });
  });

  // ─── addAuthorizedCaller / removeAuthorizedCaller ─────────────────────────

  describe("addAuthorizedCaller / removeAuthorizedCaller", function () {
    it("owner adds and removes authorized callers", async function () {
      const { paymaster, user } = await loadFixture(deployFixture);
      await paymaster.write.addAuthorizedCaller([user.account.address]);
      expect(await paymaster.read.authorizedCallers([user.account.address])).to.be.true;

      await paymaster.write.removeAuthorizedCaller([user.account.address]);
      expect(await paymaster.read.authorizedCallers([user.account.address])).to.be.false;
    });

    it("reverts for non-owner", async function () {
      const { paymasterAsOther, user } = await loadFixture(deployFixture);
      await expect(
        paymasterAsOther.write.addAuthorizedCaller([user.account.address]),
      ).to.be.rejectedWith("OwnableUnauthorizedAccount");
    });

    it("reverts for zero address", async function () {
      const { paymaster } = await loadFixture(deployFixture);
      await expect(
        paymaster.write.addAuthorizedCaller([zeroAddress]),
      ).to.be.rejectedWith("Zero address");
    });
  });

  // ─── setDailyLimit ────────────────────────────────────────────────────────

  describe("setDailyLimit", function () {
    it("owner updates daily limit", async function () {
      const { paymaster } = await loadFixture(deployFixture);
      await paymaster.write.setDailyLimit([parseEther("5")]);
      expect(await paymaster.read.dailyLimit()).to.equal(parseEther("5"));
    });

    it("reverts for non-owner", async function () {
      const { paymasterAsOther } = await loadFixture(deployFixture);
      await expect(
        paymasterAsOther.write.setDailyLimit([parseEther("5")]),
      ).to.be.rejectedWith("OwnableUnauthorizedAccount");
    });
  });

  // ─── deployRegistry ───────────────────────────────────────────────────────

  describe("deployRegistry", function () {
    it("whitelisted user deploys a registry and credit is consumed", async function () {
      const { paymaster, paymasterAsOther, other, impl } = await loadFixture(deployFixture);
      await paymaster.write.setUserWhitelist([other.account.address, 2n]);

      await paymasterAsOther.write.deployRegistry([
        impl.address, // implementation — MockTdocDeployer ignores this
        "Trade Trust",
        "TT",
      ]);

      expect(await paymaster.read.userWhitelist([other.account.address])).to.equal(1n);
    });

    it("deployed registry is auto-authorized", async function () {
      const { paymaster, paymasterAsOther, other, impl, publicClient } =
        await loadFixture(deployFixture);
      await paymaster.write.setUserWhitelist([other.account.address, 1n]);

      const hash = await paymasterAsOther.write.deployRegistry([impl.address, "TT", "TT"]);
      await publicClient.waitForTransactionReceipt({ hash });

      const events = await paymaster.getEvents.RegistryDeployed();
      const deployed = events[0].args.deployed as `0x${string}`;
      expect(await paymaster.read.authorizedRegistries([deployed])).to.be.true;
    });

    it("reverts when user has no credits", async function () {
      const { paymasterAsOther, impl } = await loadFixture(deployFixture);
      await expect(
        paymasterAsOther.write.deployRegistry([impl.address, "TT", "TT"]),
      ).to.be.rejectedWith("No deployment credits");
    });

    it("hands admin + all operational roles to msg.sender; paymaster keeps minter/restorer/accepter but not admin", async function () {
      const { paymaster, paymasterAsOther, other, impl, publicClient } =
        await loadFixture(deployFixture);
      await paymaster.write.setUserWhitelist([other.account.address, 1n]);

      const hash = await paymasterAsOther.write.deployRegistry([impl.address, "TT", "TT"]);
      await publicClient.waitForTransactionReceipt({ hash });

      const events = await paymaster.getEvents.RegistryDeployed();
      const deployedAddr = events[0].args.deployed as `0x${string}`;
      const registry = await hre.viem.getContractAt("MockRegistry", deployedAddr);

      const DEFAULT_ADMIN_ROLE = await registry.read.DEFAULT_ADMIN_ROLE();
      const MINTER_ROLE = await registry.read.MINTER_ROLE();
      const RESTORER_ROLE = await registry.read.RESTORER_ROLE();
      const ACCEPTER_ROLE = await registry.read.ACCEPTER_ROLE();

      // msg.sender (the deploying EOA) ends up holding all four roles
      expect(await registry.read.hasRole([DEFAULT_ADMIN_ROLE, other.account.address])).to.be.true;
      expect(await registry.read.hasRole([RESTORER_ROLE, other.account.address])).to.be.true;
      expect(await registry.read.hasRole([ACCEPTER_ROLE, other.account.address])).to.be.true;
      expect(await registry.read.hasRole([MINTER_ROLE, other.account.address])).to.be.true;

      // paymaster relinquishes admin but keeps the operational roles
      expect(await registry.read.hasRole([DEFAULT_ADMIN_ROLE, paymaster.address])).to.be.false;
      expect(await registry.read.hasRole([RESTORER_ROLE, paymaster.address])).to.be.true;
      expect(await registry.read.hasRole([ACCEPTER_ROLE, paymaster.address])).to.be.true;
      expect(await registry.read.hasRole([MINTER_ROLE, paymaster.address])).to.be.true;
    });
  });

  // ─── mintDocument ─────────────────────────────────────────────────────────

  describe("mintDocument", function () {
    it("mints a document, authorizes beneficiary+holder+escrow, increments counter", async function () {
      const { paymaster, paymasterAsOther, mockRegistry, other, user } =
        await loadFixture(deployFixture);

      // Authorize the registry
      await paymaster.write.addRegistry([mockRegistry.address]);

      await paymasterAsOther.write.mintDocument([
        mockRegistry.address,
        user.account.address,  // beneficiary
        other.account.address, // holder
        1n,
        "0x" as `0x${string}`,
      ]);

      expect(await paymaster.read.documentsMinted([other.account.address])).to.equal(1n);
      expect(await paymaster.read.authorizedCallers([user.account.address])).to.be.true;
      expect(await paymaster.read.authorizedCallers([other.account.address])).to.be.true;

      // TitleEscrowLinked event tells us the escrow address
      const events = await paymaster.getEvents.TitleEscrowLinked();
      expect(events).to.have.lengthOf(1);
      const escrow = events[0].args.titleEscrow as `0x${string}`;
      expect(await paymaster.read.authorizedTitleEscrows([escrow])).to.be.true;
    });

    it("reverts for an unauthorized registry", async function () {
      const { paymasterAsOther, mockRegistry, other, user } = await loadFixture(deployFixture);
      await expect(
        paymasterAsOther.write.mintDocument([
          mockRegistry.address, // not yet authorized
          user.account.address,
          other.account.address,
          1n,
          "0x" as `0x${string}`,
        ]),
      ).to.be.rejectedWith("registry not authorized");
    });

    it("documentsMinted increments per caller", async function () {
      const { paymaster, paymasterAsOther, mockRegistry, other, user } =
        await loadFixture(deployFixture);
      await paymaster.write.addRegistry([mockRegistry.address]);

      await paymasterAsOther.write.mintDocument([
        mockRegistry.address, user.account.address, other.account.address, 1n, "0x" as `0x${string}`,
      ]);
      await paymasterAsOther.write.mintDocument([
        mockRegistry.address, user.account.address, other.account.address, 2n, "0x" as `0x${string}`,
      ]);

      expect(await paymaster.read.documentsMinted([other.account.address])).to.equal(2n);
    });
  });

  // ─── getUserDailySpend ────────────────────────────────────────────────────

  describe("getUserDailySpend", function () {
    it("returns zero spend for a fresh user", async function () {
      const { paymaster, user } = await loadFixture(deployFixture);
      const [spent, limit] = await paymaster.read.getUserDailySpend([user.account.address]);
      expect(spent).to.equal(0n);
      expect(limit).to.equal(parseEther("1"));
    });
  });
});
