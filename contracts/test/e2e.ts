import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import hre from "hardhat";

describe("E2E: Rental RWA Lifecycle", function () {

  async function deployFixture() {
    const [
      admin,
      factory,
      compliance,
      paymentCollector,
      tenant,
      investor
    ] = await hre.ethers.getSigners();

    /* -----------------------------------------------------------
       Deploy Registry
    ----------------------------------------------------------- */
    const Registry = await hre.ethers.getContractFactory("RWAAssetRegistry");
    const registry = await Registry.deploy();

    await registry.grantRole(await registry.ASSET_FACTORY_ROLE(), factory.address);
    await registry.grantRole(await registry.COMPLIANCE_ROLE(), compliance.address);
    await registry.grantRole(await registry.PAYMENT_COLLECTOR_ROLE(), paymentCollector.address);

    await registry.connect(compliance).verifyKYC(factory.address);

    /* -----------------------------------------------------------
       Deploy Payment Token (USDC mock)
    ----------------------------------------------------------- */
    const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("USD Coin", "USDC");

    await usdc.mint(tenant.address, hre.ethers.parseUnits("10000", 18));

    /* -----------------------------------------------------------
       Register Asset
    ----------------------------------------------------------- */

    const assetId = await registry.connect(factory).registerAsset.staticCall(
        0, // REAL_ESTATE
        factory.address,
        1_000_000,
        "ipfs://test"
      );
    await registry.connect(factory).registerAsset(
        0, // REAL_ESTATE
        factory.address,
        1_000_000,
        "ipfs://test"
      );


    await registry.connect(compliance).whitelistAsset(assetId);

    /* -----------------------------------------------------------
       Deploy Logic
    ----------------------------------------------------------- */
    const Logic = await hre.ethers.getContractFactory("RentalCashFlowLogic");
    const logic = await Logic.deploy();

    const rent = hre.ethers.parseUnits("1000", 18);
    const interval = 30 * 24 * 60 * 60;
    const graceDays = 5;
    const leaseEnd = (await time.latest()) + 6 * interval;

    const initData = hre.ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256", "uint256", "uint256"],
      [rent, interval, graceDays, leaseEnd]
    );

    await logic.initialize(initData);

    /* -----------------------------------------------------------
       Deploy Vault
    ----------------------------------------------------------- */
    const Vault = await hre.ethers.getContractFactory("RWARevenueVault");
    const vault = await Vault.deploy();

    await vault.initialize(
      admin.address,
      logic.target,
      usdc.target,
      registry.target,
      assetId
    );

    await vault.grantRole(await vault.PAYMENT_ROLE(), paymentCollector.address);


    /* -----------------------------------------------------------
       Deploy Investor Token
    ----------------------------------------------------------- */
    const Token = await hre.ethers.getContractFactory("InvestorShareToken");
    const token = await Token.deploy(
      assetId,
      "RWA SG Office",
      "RWA-SG",
      hre.ethers.parseUnits("1000", 18),
      registry.target,
      vault.target
    );

    await vault.setTokenContracts(token.target);

    await registry.connect(factory).linkContracts(
      assetId,
      logic.target,
      vault.target,
      token.target
    );

    /* -----------------------------------------------------------
       Activate Asset
    ----------------------------------------------------------- */
    await registry.connect(compliance).activateAsset(assetId);

    /* -----------------------------------------------------------
       Mint Investor Shares
    ----------------------------------------------------------- */
    await vault.mintShares(investor.address, hre.ethers.parseUnits("100", 18));

    return {
      registry,
      logic,
      vault,
      token,
      usdc,
      assetId,
      tenant,
      investor,
      paymentCollector
    };
  }

  it("runs full rental lifecycle (pay → distribute → claim → default)", async function () {
    const {
      registry,
      logic,
      vault,
      token,
      usdc,
      assetId,
      tenant,
      investor,
      paymentCollector
    } = await loadFixture(deployFixture);

    /* -----------------------------------------------------------
       Tenant pays rent
    ----------------------------------------------------------- */
    await usdc.connect(tenant).approve(vault.target, hre.ethers.parseUnits("1000", 18));
    await vault.connect(paymentCollector).depositRevenue(
      tenant.address,
      hre.ethers.parseUnits("1000", 18)
    );

    await logic.processPayment(
      hre.ethers.parseUnits("1000", 18),
      await time.latest()
    );

    await vault.commitToDistribution(hre.ethers.parseUnits("1000", 18));

    /* -----------------------------------------------------------
       Investor claims yield
    ----------------------------------------------------------- */
    const balanceBefore = await usdc.balanceOf(investor.address);

    await vault.connect(investor).claimYield();

    const balanceAfter = await usdc.balanceOf(investor.address);
    expect(balanceAfter).to.be.gt(balanceBefore);

    /* -----------------------------------------------------------
       Miss two rent periods → default
    ----------------------------------------------------------- */
    await time.increase(31 * 24 * 60 * 60);
    await logic.evaluateDefault(await time.latest());
    await registry.checkAndTriggerDefault(assetId);

    await time.increase(31 * 24 * 60 * 60);
    await logic.evaluateDefault(await time.latest());
    await registry.checkAndTriggerDefault(assetId);

    const asset = await registry.assets(assetId);
    expect(asset.currentStatus).to.equal(3); // DEFAULTED
  });
});
