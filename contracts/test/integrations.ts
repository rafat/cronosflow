import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import hre from "hardhat";

describe("Integration: Multi-Investor Distribution", function () {

  async function fixture() {
    const [admin, investorA, investorB, tenant] = await hre.ethers.getSigners();

    // Deploy payment token
    const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("USD Coin", "USDC");

    // Mint funds
    await usdc.mint(tenant.address, hre.ethers.parseUnits("10000", 18));

    // Deploy vault
    const Vault = await hre.ethers.getContractFactory("RWARevenueVault");
    const vault = await Vault.deploy();

    // Deploy registry mock
    const Registry = await hre.ethers.getContractFactory("MockRegistry");
    const registry = await Registry.deploy();

    await vault.initialize(
      admin.address,
      hre.ethers.ZeroAddress,
      usdc.target,
      registry.target,
      1
    );

    // Deploy token
    const Token = await hre.ethers.getContractFactory("InvestorShareToken");
    const token = await Token.deploy(
      1,
      "RWA Token",
      "RWA",
      hre.ethers.parseUnits("1000", 18),
      registry.target,
      vault.target
    );

    await vault.setTokenContracts(token.target);

    // Mint shares
    await vault.mintShares(investorA.address, hre.ethers.parseUnits("600", 18));
    await vault.mintShares(investorB.address, hre.ethers.parseUnits("400", 18));

    return { vault, token, usdc, investorA, investorB, tenant, admin };
  }

  it("distributes yield pro-rata across investors", async () => {
    const { vault, usdc, investorA, investorB, tenant, admin } =
      await loadFixture(fixture);

    // Deposit & distribute 1000 USDC
    await usdc.connect(tenant).approve(vault.target, hre.ethers.parseUnits("1000", 18));
    await vault.connect(admin).depositRevenue(tenant.address, hre.ethers.parseUnits("1000", 18));
    await vault.commitToDistribution(hre.ethers.parseUnits("1000", 18));

    await vault.connect(investorA).claimYield();
    await vault.connect(investorB).claimYield();

    const balA = await usdc.balanceOf(investorA.address);
    const balB = await usdc.balanceOf(investorB.address);

    expect(balA).to.equal(hre.ethers.parseUnits("585", 18));
    expect(balB).to.equal(hre.ethers.parseUnits("390", 18));
  });

  it("claim order does not affect payouts", async () => {
    const { vault, usdc, investorA, investorB, tenant, admin } =
      await loadFixture(fixture);

    await usdc.connect(tenant).approve(vault.target, hre.ethers.parseUnits("1000", 18));
    await vault.connect(admin).depositRevenue(tenant.address, hre.ethers.parseUnits("1000", 18));
    await vault.commitToDistribution(hre.ethers.parseUnits("1000", 18));

    // Reverse order
    await vault.connect(investorB).claimYield();
    await vault.connect(investorA).claimYield();

    expect(await usdc.balanceOf(investorA.address)).to.equal(hre.ethers.parseUnits("585", 18));
    expect(await usdc.balanceOf(investorB.address)).to.equal(hre.ethers.parseUnits("390", 18));
  });
});
