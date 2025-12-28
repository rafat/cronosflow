import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import hre from "hardhat";

describe("RentalCashFlowLogic", function () {
  async function deployFixture() {
    const [registrySigner] = await hre.ethers.getSigners();

    const Logic = await hre.ethers.getContractFactory("RentalCashFlowLogic");
    const logic = await Logic.deploy();

    const rentAmount = hre.ethers.parseUnits("1000", 18);
    const paymentInterval = 30 * 24 * 60 * 60;
    const gracePeriodDays = 5;

    const firstDue = await time.latest() + 60;
    const leaseEndDate = firstDue + 180 * 24 * 60 * 60; // ~6 months

    const registry = registrySigner.address;

    const initData = hre.ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256", "uint256", "uint256", "uint256", "address"],
      [rentAmount, paymentInterval, firstDue, gracePeriodDays, leaseEndDate, registry]
    );

    await logic.initialize(initData);

    return { logic, rentAmount, paymentInterval, gracePeriodDays, leaseEndDate, firstDue, registrySigner };
  }

  describe("Initialization", function () {
    it("initializes once", async function () {
      const { logic } = await loadFixture(deployFixture);
      await expect(logic.initialize("0x")).to.be.revertedWith("Already initialized");
    });

    it("starts in PERFORMING state", async function () {
      const { logic } = await loadFixture(deployFixture);
      expect(await logic.getCashflowHealth()).to.equal(0); // PERFORMING
    });
  });

  describe("Payments", function () {
    it("accepts rent payment for current period (if processPayment not restricted)", async function () {
      const { logic, rentAmount, registrySigner } = await loadFixture(deployFixture);

      await expect(logic.connect(registrySigner).processPayment(rentAmount, await time.latest())).not.to.be.reverted;
      expect(await logic.getTotalReceived()).to.equal(rentAmount);
    });
    });

  describe("Late & default logic (preview)", function () {
    it("previews GRACE_PERIOD after due date", async function () {
      const { logic, firstDue, paymentInterval, gracePeriodDays } = await loadFixture(deployFixture);

      await time.increaseTo(firstDue + 1);

      const [, health] = await logic.previewDefault(await time.latest());
      expect(health).to.equal(1); // GRACE_PERIOD
    });

    it("previews LATE after grace period", async function () {
      const { logic, gracePeriodDays, firstDue } = await loadFixture(deployFixture);

      const t0 = firstDue + gracePeriodDays * 24 * 60 * 60 + 1;
      await time.increaseTo(t0);

      const [, health] = await logic.previewDefault(await time.latest());
      expect(health).to.equal(2); // LATE
    });

    it("previews DEFAULTED after two missed periods", async function () {
      const { logic, paymentInterval, gracePeriodDays, firstDue } = await loadFixture(deployFixture);

      const t0 = firstDue + gracePeriodDays * 24 * 60 * 60 + 1;
      await time.increaseTo(t0);

      let [status0, health0] = await logic.previewDefault(await time.latest());
      expect(health0).to.equal(2); // LATE
      expect(status0).to.equal(2); // ACTIVE

      const t1 = firstDue + paymentInterval + gracePeriodDays * 24 * 60 * 60 + 1;
      await time.increaseTo(t1);

      let [status1, health1] = await logic.previewDefault(await time.latest());
      expect(health1).to.equal(3); // DEFAULTED
      expect(status1).to.equal(4); // AssetStatus.DEFAULTED
    });
  });

  describe("Lease maturity (preview)", function () {
    it("previews COMPLETED after lease end", async function () {
      const { logic, leaseEndDate } = await loadFixture(deployFixture);

      await time.increaseTo(leaseEndDate + 1);

      const [status, health] = await logic.previewDefault(await time.latest());
      expect(health).to.equal(4); // COMPLETED
      expect(status).to.equal(8); // EXPIRED
    });
  });
});