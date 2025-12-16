import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import hre from "hardhat";

describe("RWARevenueVault + InvestorShareToken", function () {

  async function deployFixture() {
    const [owner, investor1, investor2] = await hre.ethers.getSigners();

    // Deploy mock registry
    const Registry = await hre.ethers.getContractFactory("MockRegistry");
    const registry = await Registry.deploy();

    // Deploy mock payment token (ERC20Preset)
    const ERC20 = await hre.ethers.getContractFactory("MockERC20");
    const paymentToken = await ERC20.deploy("USD Coin", "USDC");

    // Mint USDC to owner
    await paymentToken.mint(owner.address, hre.ethers.parseUnits("10000", 18));

    // Deploy vault
    const Vault = await hre.ethers.getContractFactory("RWARevenueVault");
    const vault = await Vault.deploy();

    await vault.initialize(
      owner.address,
      hre.ethers.ZeroAddress, // logic unused in vault
      paymentToken.target,
      registry.target,
      1 // assetId
    );

    // Deploy token
    const Token = await hre.ethers.getContractFactory("InvestorShareToken");
    const token = await Token.deploy(
      1,
      "RWA Asset #1",
      "RWA1",
      hre.ethers.parseUnits("1000", 18),
      registry.target,
      vault.target
    );

    await vault.setTokenContracts(token.target);

    // Grant vault mint/burn control implicitly via constructor

    return {
      owner,
      investor1,
      investor2,
      registry,
      paymentToken,
      vault,
      token,
    };
  }

  /* ================================================================
     TOKEN TESTS
     ================================================================ */

  describe("InvestorShareToken", function () {
    it("Only vault can mint", async function () {
      const { token, investor1 } = await loadFixture(deployFixture);

      await expect(
        token.mint(investor1.address, 100)
      ).to.be.reverted;
    });

    it("Mints within max supply", async function () {
      const { token, vault, investor1, owner } = await loadFixture(deployFixture);

      await vault.mintShares(investor1.address, 500);
      expect(await token.totalSupply()).to.equal(500);
    });

    it("Rejects mint above max supply", async function () {
      const { token, vault, investor1, owner } = await loadFixture(deployFixture);

      await expect(
        vault.mintShares(investor1.address, hre.ethers.parseUnits("2000", 18))
      ).to.be.revertedWith("Max supply exceeded");
    });
  });

  /* ================================================================
     VAULT: REVENUE & DISTRIBUTION
     ================================================================ */

  describe("Revenue flow", function () {
    it("Deposits revenue into idle balance", async function () {
      const { vault, paymentToken, owner } = await loadFixture(deployFixture);

      await paymentToken.approve(vault.target, 1000);
      await vault.depositRevenue(1000);

      expect(await vault.getAvailableForDeployment()).to.equal(1000);
    });

    it("Commits distribution and updates index", async function () {
      const { vault, token, paymentToken, owner, investor1 } =
        await loadFixture(deployFixture);

      // Mint shares
      await vault.mintShares(investor1.address, 100);

      // Deposit revenue
      await paymentToken.approve(vault.target, 1000);
      await vault.depositRevenue(1000);

      await vault.commitToDistribution(1000);

      expect(await vault.getAvailableForInvestors()).to.be.gt(0);
      expect(await vault.cumulativeRewardPerToken()).to.be.gt(0);
    });
  });

  /* ================================================================
     CLAIM LOGIC (CRITICAL)
     ================================================================ */

  describe("claimYield()", function () {
    it("Allows investor to claim yield once", async function () {
      const { vault, token, paymentToken, investor1 } =
        await loadFixture(deployFixture);

      await vault.mintShares(investor1.address, 100);

      await paymentToken.approve(vault.target, 1000);
      await vault.depositRevenue(1000);
      await vault.commitToDistribution(1000);

      const expectedReward = 975;
      await expect(
        vault.connect(investor1).claimYield()
      ).to.changeTokenBalance(paymentToken, investor1, expectedReward);
    });

    it("Prevents double-claiming", async function () {
      const { vault, token, paymentToken, investor1 } =
        await loadFixture(deployFixture);

      await vault.mintShares(investor1.address, 100);

      await paymentToken.approve(vault.target, 1000);
      await vault.depositRevenue(1000);
      await vault.commitToDistribution(1000);

      await vault.connect(investor1).claimYield();

      await expect(
        vault.connect(investor1).claimYield()
      ).to.be.revertedWith("No pending rewards");
    });
  });

  /* ================================================================
     LIFECYCLE GATING
     ================================================================ */

  describe("Lifecycle enforcement", function () {
    it("Blocks claims when asset inactive", async function () {
      const { vault, registry, investor1 } =
        await loadFixture(deployFixture);

      await registry.setActive(false);

      await expect(
        vault.connect(investor1).claimYield()
      ).to.be.revertedWith("Asset not active");
    });
  });
});
