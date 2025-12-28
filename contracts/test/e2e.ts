import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import hre from "hardhat";

describe("E2E: Rental RWA Lifecycle", function () {
  async function deployFixture() {
    const [admin, factory, compliance, paymentCollector, tenant, investor, agent] =
      await hre.ethers.getSigners();

    // -------------------------
    // Deploy registry + roles
    // -------------------------
    const Registry = await hre.ethers.getContractFactory("RWAAssetRegistry");
    const registry = await Registry.deploy(admin.address);

    await registry.grantRole(await registry.ASSET_FACTORY_ROLE(), factory.address);
    await registry.grantRole(await registry.COMPLIANCE_ROLE(), compliance.address);
    await registry.grantRole(await registry.PAYMENT_COLLECTOR_ROLE(), paymentCollector.address);

    await registry.connect(compliance).verifyKYC(factory.address);
    await registry.connect(compliance).verifyKYC(investor.address);
    await registry.connect(compliance).whitelistRecipient(investor.address);

    // -------------------------
    // Deploy payment token (mock USDC)
    // -------------------------
    const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("USD Coin", "USDC");
    await usdc.mint(tenant.address, hre.ethers.parseUnits("10000", 18));

    // -------------------------
    // Register asset
    // -------------------------
    const assetId = await registry.connect(factory).registerAsset.staticCall(
      0, // AssetType.REAL_ESTATE
      factory.address,
      1_000_000,
      "ipfs://test"
    );
    await registry.connect(factory).registerAsset(0, factory.address, 1_000_000, "ipfs://test");

    // -------------------------
    // Deploy + init rental logic
    // -------------------------
    const Logic = await hre.ethers.getContractFactory("RentalCashFlowLogic");
    const logic = await Logic.deploy();

    const rent = hre.ethers.parseUnits("1000", 18);
    const interval = 30 * 24 * 60 * 60;
    const graceDays = 5;

    const firstDue = await time.latest() + 60;
    const leaseEnd = firstDue + 6 * interval;

    // IMPORTANT: now includes registry address (6th param)
    const initData = hre.ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256", "uint256", "uint256", "uint256", "address"],
      [rent, interval, firstDue, graceDays, leaseEnd, registry.target]
    );
    await logic.initialize(initData);

    // -------------------------
    // Deploy vault
    // -------------------------
    const Vault = await hre.ethers.getContractFactory("RWARevenueVault");
    const vault = await Vault.deploy();

    await vault.initialize(admin.address, agent.address, logic.target, usdc.target, registry.target, assetId, admin.address);
    await vault.grantRole(await vault.PAYMENT_ROLE(), paymentCollector.address);

    // -------------------------
    // Deploy investor token
    // -------------------------
    const Token = await hre.ethers.getContractFactory("InvestorShareToken");
    const token = await Token.deploy(
      assetId,
      "RWA SG Office",
      "RWA-SG",
      hre.ethers.parseUnits("1000", 18),
      registry.target,
      vault.target,
      admin.address
    );

    await vault.setTokenContracts(token.target);

    // -------------------------
    // Link contracts + activate asset
    // -------------------------
    await registry.connect(factory).linkContracts(assetId, logic.target, vault.target, token.target);
    await registry.connect(compliance).activateAsset(assetId);

    // Mint shares to investor
    await vault.mintShares(investor.address, hre.ethers.parseUnits("100", 18));

    return {
      registry,
      logic,
      vault,
      usdc,
      assetId,
      tenant,
      investor,
      paymentCollector,
      rent,
      interval,
      graceDays,
      firstDue,
      admin,
      agent
    };
  }

  it("runs full rental lifecycle (pay → distribute → claim → default)", async function () {
    const {
      registry,
      logic,
      vault,
      usdc,
      assetId,
      tenant,
      investor,
      paymentCollector,
      rent,
      interval,
      graceDays,
      firstDue,
      admin,
      agent
    } = await loadFixture(deployFixture);

    const DAY = 24 * 60 * 60;

    // -------------------------
    // Tenant pays rent into vault
    // -------------------------
    await usdc.connect(tenant).approve(vault.target, rent);
    await vault.connect(paymentCollector).depositRevenue(tenant.address, rent);

    // NOTE:
    // If you later restrict `processPayment()` to onlyRegistry/onlyVault,
    // you'll need to route this call through that authorized component.
    await registry.connect(paymentCollector).recordPayment(assetId, rent);

    // Commit to distribution (checks against logic.getSchedule().expected)
    await vault.connect(paymentCollector).commitToDistribution(rent);

    // Investor claims yield
    const balanceBefore = await usdc.balanceOf(investor.address);
    await vault.connect(investor).claimYield();
    const balanceAfter = await usdc.balanceOf(investor.address);
    expect(balanceAfter).to.be.gt(balanceBefore);

    // -------------------------
    // Miss two rent periods → registry triggers default
    // Use exact timestamps (increaseTo) to avoid ambiguity.
    // -------------------------

    // Past grace for period 1 (=> LATE)
  const t1 = firstDue + interval + graceDays * DAY + 1;
  await time.increaseTo(t1);
  await registry.checkAndTriggerDefault(assetId);

  // Past grace for period 2 (=> DEFAULTED)
  const t2 = firstDue + 2 * interval + graceDays * DAY + 1;
  await time.increaseTo(t2);
  await registry.checkAndTriggerDefault(assetId);

  const asset = await registry.assets(assetId);
  expect(asset.currentStatus).to.equal(4); // DEFAULTED
  });
});