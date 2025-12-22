import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import hre from "hardhat";

describe("RWAAssetRegistry", function () {
  async function deployFixture() {
    const [admin, factory, compliance, payment] = await hre.ethers.getSigners();

    const Registry = await hre.ethers.getContractFactory("RWAAssetRegistry");
    const registry = await Registry.deploy();

    await registry.grantRole(await registry.ASSET_FACTORY_ROLE(), factory.address);
    await registry.grantRole(await registry.COMPLIANCE_ROLE(), compliance.address);
    await registry.grantRole(await registry.PAYMENT_COLLECTOR_ROLE(), payment.address);

    await registry.connect(compliance).verifyKYC(factory.address);

    return { registry, admin, factory, compliance, payment };
  }

  describe("Registration", function () {
    it("registers a new asset", async function () {
      const { registry, factory } = await loadFixture(deployFixture);

      const assetId = await registry.connect(factory).registerAsset.staticCall(
        0,
        factory.address,
        1_000_000,
        "ipfs://test"
      );
      await registry.connect(factory).registerAsset(0, factory.address, 1_000_000, "ipfs://test");

      const asset = await registry.assets(assetId);
      expect(asset.originator).to.equal(factory.address);
    });
  });

  describe("Activation", function () {
    it("activates asset after compliance approval", async function () {
      const { registry, factory, compliance } = await loadFixture(deployFixture);

      const assetId = await registry.connect(factory).registerAsset.staticCall(0, factory.address, 1000, "ipfs");
      await registry.connect(factory).registerAsset(0, factory.address, 1000, "ipfs");

      await registry.connect(compliance).whitelistAsset(assetId);

      await registry.connect(factory).linkContracts(
        assetId,
        hre.ethers.Wallet.createRandom().address,
        hre.ethers.Wallet.createRandom().address,
        hre.ethers.Wallet.createRandom().address
      );

      await expect(registry.connect(compliance).activateAsset(assetId)).not.to.be.reverted;

      const asset = await registry.assets(assetId);
      expect(asset.currentStatus).to.equal(2); // ACTIVE (NEW INDEX)
    });
  });

  describe("Default detection", function () {
    it("marks asset as DEFAULTED after missed payments", async function () {
      const { registry, factory, payment, compliance } = await loadFixture(deployFixture);

      const assetId = await registry.connect(factory).registerAsset.staticCall(0, factory.address, 1000, "ipfs");
      await registry.connect(factory).registerAsset(0, factory.address, 1000, "ipfs");

      await registry.connect(compliance).whitelistAsset(assetId);

      // IMPORTANT: checkAndTriggerDefault now requires a logic contract.
      // So this unit test must deploy a simple logic mock that defaults.
      const DefaultingLogic = await hre.ethers.getContractFactory("DefaultingLogicMock");
      const logic = await DefaultingLogic.deploy();

      await registry.connect(factory).linkContracts(
        assetId,
        logic.target,
        hre.ethers.Wallet.createRandom().address,
        hre.ethers.Wallet.createRandom().address
      );

      await registry.connect(compliance).activateAsset(assetId);

      // Jump ahead twice to trigger default in the mock (or in your real rental logic you’d do it differently)
      await registry.connect(payment).checkAndTriggerDefault(assetId);

      const asset = await registry.assets(assetId);
      expect(asset.currentStatus).to.equal(4); // DEFAULTED (NEW INDEX)
    });
  });
});