import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";

describe("EIP7702Implementation", function () {
  async function deployFixture() {
    const mockEntryPoint = await hre.viem.deployContract("MockEntryPoint");
    const impl = await hre.viem.deployContract("EIP7702Implementation", [
      mockEntryPoint.address,
    ]);
    return { impl };
  }

  // ─── ERC-165 ───────────────────────────────────────────────────────────────

  describe("supportsInterface", function () {
    it("supports ERC-7821 (execute(bytes32,bytes) ^ supportsExecutionMode(bytes32))", async function () {
      const { impl } = await loadFixture(deployFixture);
      expect(await impl.read.supportsInterface(["0x39922547"])).to.be.true;
    });

    it("supports ERC-165", async function () {
      const { impl } = await loadFixture(deployFixture);
      expect(await impl.read.supportsInterface(["0x01ffc9a7"])).to.be.true;
    });

    it("does not support the previously hardcoded (incorrect) ID", async function () {
      const { impl } = await loadFixture(deployFixture);
      expect(await impl.read.supportsInterface(["0x4e49c5c7"])).to.be.false;
    });

    it("does not support 0xffffffff", async function () {
      const { impl } = await loadFixture(deployFixture);
      expect(await impl.read.supportsInterface(["0xffffffff"])).to.be.false;
    });
  });
});
