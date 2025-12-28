import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import hre from "hardhat";

describe("RWARevenueVault + InvestorShareToken", function () {
  async function deployFixture() {
    const [owner, investor1, investor2, agent] = await hre.ethers.getSigners();

    const Registry = await hre.ethers.getContractFactory("MockRegistry");
    const registry = await Registry.deploy();

    const ERC20 = await hre.ethers.getContractFactory("MockERC20");
    const paymentToken = await ERC20.deploy("USD Coin", "USDC");
    await paymentToken.mint(owner.address, hre.ethers.parseUnits("10000", 18));

    // NEW: mock logic required because vault.commitToDistribution calls getSchedule()
    const MockLogic = await hre.ethers.getContractFactory("MockCashFlowLogic");
    const logic = await MockLogic.deploy(hre.ethers.parseUnits("1000", 18));

    const Vault = await hre.ethers.getContractFactory("RWARevenueVault");
    const vault = await Vault.deploy();

    await vault.initialize(
      owner.address,
      agent.address,
      logic.target,
      paymentToken.target,
      registry.target,
      1,
      owner.address
    );

    const Token = await hre.ethers.getContractFactory("InvestorShareToken");
    const token = await Token.deploy(
      1,
      "RWA Asset #1",
      "RWA1",
      hre.ethers.parseUnits("1000", 18),
      registry.target,
      vault.target,
      owner.address
    );

    await vault.setTokenContracts(token.target);

    return { owner, investor1, investor2, agent, registry, paymentToken, vault, token };
  }

  describe("InvestorShareToken", function () {
    it("Only vault can mint", async function () {
      const { token, investor1 } = await loadFixture(deployFixture);
      await expect(token.mint(investor1.address, 100)).to.be.reverted;
    });

    it("Mints within max supply", async function () {
      const { token, vault, investor1 } = await loadFixture(deployFixture);
      await vault.mintShares(investor1.address, 500);
      expect(await token.totalSupply()).to.equal(500);
    });

    it("Rejects mint above max supply", async function () {
      const { vault, investor1 } = await loadFixture(deployFixture);
      await expect(
        vault.mintShares(investor1.address, hre.ethers.parseUnits("2000", 18))
      ).to.be.revertedWith("Max supply exceeded");
    });
  });

  describe("Revenue flow", function () {
    it("Deposits revenue into idle balance", async function () {
      const { vault, paymentToken, owner, agent } = await loadFixture(deployFixture);
      await paymentToken.connect(owner).transfer(agent.address, 1000);
      await paymentToken.connect(agent).approve(vault.target, 1000);
      await vault.connect(agent).depositRevenue(agent.address, 1000);
      expect(await vault.getAvailableForDeployment()).to.equal(1000);
    });

    it("Commits distribution and updates index", async function () {
      const { vault, paymentToken, owner, agent, investor1 } = await loadFixture(deployFixture);

      await vault.mintShares(investor1.address, 100);

      await paymentToken.connect(owner).transfer(agent.address, hre.ethers.parseUnits("1000", 18));
      await paymentToken.connect(agent).approve(vault.target, hre.ethers.parseUnits("1000", 18));
      await vault.connect(agent).depositRevenue(agent.address, hre.ethers.parseUnits("1000", 18));

      await vault.connect(agent).commitToDistribution(hre.ethers.parseUnits("1000", 18));

      expect(await vault.getAvailableForInvestors()).to.be.gt(0);
      expect(await vault.cumulativeRewardPerToken()).to.be.gt(0);
    });
  });

  describe("claimYield()", function () {
    it("Allows investor to claim yield once", async function () {
      const { vault, paymentToken, investor1, owner, agent } = await loadFixture(deployFixture);

      await vault.mintShares(investor1.address, 100);

      await paymentToken.connect(owner).transfer(agent.address, hre.ethers.parseUnits("1000", 18));
      await paymentToken.connect(agent).approve(vault.target, hre.ethers.parseUnits("1000", 18));
      await vault.connect(agent).depositRevenue(agent.address, hre.ethers.parseUnits("1000", 18));
      await vault.connect(agent).commitToDistribution(hre.ethers.parseUnits("1000", 18));

      const expectedReward = hre.ethers.parseUnits("975", 18);

      await expect(() => vault.connect(investor1).claimYield()).to.changeTokenBalance(
        paymentToken,
        investor1,
        expectedReward
      );
    });

    it("Prevents double-claiming", async function () {
      const { vault, paymentToken, investor1, owner, agent } = await loadFixture(deployFixture);

      await vault.mintShares(investor1.address, 100);

      await paymentToken.connect(owner).transfer(agent.address, hre.ethers.parseUnits("1000", 18));
      await paymentToken.connect(agent).approve(vault.target, hre.ethers.parseUnits("1000", 18));
      await vault.connect(agent).depositRevenue(agent.address, hre.ethers.parseUnits("1000", 18));
      await vault.connect(agent).commitToDistribution(hre.ethers.parseUnits("1000", 18));

      await vault.connect(investor1).claimYield();

      await expect(vault.connect(investor1).claimYield()).to.be.revertedWith("No pending rewards");
    });
  });

  describe("Lifecycle enforcement", function () {
    it("Blocks claims when asset inactive", async function () {
      const { vault, registry, investor1 } = await loadFixture(deployFixture);

      await registry.setActive(false);

      await expect(vault.connect(investor1).claimYield()).to.be.revertedWith("Asset not active");
    });
  });
});