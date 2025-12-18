import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import hre from "hardhat";

describe("RentalCashFlowLogic", function () {

  async function deployFixture() {
    const [owner] = await hre.ethers.getSigners();

    const Logic = await hre.ethers.getContractFactory("RentalCashFlowLogic");
    const logic = await Logic.deploy();

    const rentAmount = hre.ethers.parseUnits("1000", 18);
    const paymentInterval = 30 * 24 * 60 * 60; // 30 days
    const gracePeriodDays = 5;
    const leaseEndDate = (await time.latest()) + 180 * 24 * 60 * 60; // 6 months

    const initData = hre.ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256", "uint256", "uint256"],
      [rentAmount, paymentInterval, gracePeriodDays, leaseEndDate]
    );

    await logic.initialize(initData);

    return {
      logic,
      rentAmount,
      paymentInterval,
      gracePeriodDays,
      leaseEndDate,
    };
  }

  describe("Initialization", function () {
    it("initializes once", async function () {
      const { logic } = await loadFixture(deployFixture);

      await expect(
        logic.initialize("0x")
      ).to.be.revertedWith("Already initialized");
    });

    it("starts in PERFORMING state", async function () {
      const { logic } = await loadFixture(deployFixture);
      expect(await logic.getCashflowHealth()).to.equal(0); // PERFORMING
    });
  });

  describe("Payments", function () {
    it("accepts rent payment for current period", async function () {
      const { logic, rentAmount } = await loadFixture(deployFixture);

      await expect(
        logic.processPayment(rentAmount, await time.latest())
      ).not.to.be.reverted;

      expect(await logic.getTotalReceived()).to.equal(rentAmount);
    });

    it("rejects double payment for same period", async function () {
      const { logic, rentAmount } = await loadFixture(deployFixture);

      const now = await time.latest();
      await logic.processPayment(rentAmount, now);

      await expect(
        logic.processPayment(rentAmount, now)
      ).to.be.revertedWith("Period already paid");
    });
  });

  describe("Late & default logic", function () {
    it("enters GRACE_PERIOD after due date", async function () {
      const { logic, paymentInterval } = await loadFixture(deployFixture);

      await time.increase(paymentInterval + 1);

      const txResponse = await logic.evaluateDefault(await time.latest());
      await txResponse.wait();
      const health = await logic.getCashflowHealth();
      expect(health).to.equal(1); // GRACE_PERIOD
    });

    it("enters LATE after grace period", async function () {
      const { logic, paymentInterval, gracePeriodDays } =
        await loadFixture(deployFixture);

      await time.increase(
        paymentInterval + gracePeriodDays * 24 * 60 * 60 + 1
      );

      const txResponse = await logic.evaluateDefault(await time.latest());
      await txResponse.wait();
      const health = await logic.getCashflowHealth();
      expect(health).to.equal(2); // LATE
    });

    it("defaults after two missed periods", async function () {
      const { logic, paymentInterval, gracePeriodDays } =
        await loadFixture(deployFixture);

      // Miss first period
      await time.increase(
        paymentInterval + gracePeriodDays * 24 * 60 * 60 + 1
      );
      await logic.evaluateDefault(await time.latest());

      // Miss second period
      await time.increase(paymentInterval);
      const txResponse = await logic.evaluateDefault(await time.latest());
      await txResponse.wait();
      const health = await logic.getCashflowHealth();
      const status = await logic.getAssetStatus();

      expect(health).to.equal(3); // DEFAULTED
      expect(status).to.equal(3); // AssetStatus.DEFAULTED
    });
  });

  describe("Lease maturity", function () {
    it("completes after lease end", async function () {
      const { logic, leaseEndDate } = await loadFixture(deployFixture);

      await time.increaseTo(leaseEndDate + 1);

      const txResponse = await logic.evaluateDefault(await time.latest());
      await txResponse.wait();
      const health = await logic.getCashflowHealth();
      const status = await logic.getAssetStatus();

      expect(health).to.equal(4); // COMPLETED
      expect(status).to.equal(7); // AssetStatus.EXPIRED
    });
  });

  describe("Missed period counting", function () {
    it("does not double-count missed period on repeated evaluation", async function () {
      const { logic, paymentInterval, gracePeriodDays } = await loadFixture(deployFixture);

      // Advance time past the grace period
      await time.increase(paymentInterval + (gracePeriodDays + 1) * 24 * 60 * 60);

      // Evaluate default once - this should increment missedPeriods to 1
      await logic.evaluateDefault(await time.latest());

      // Check that missedPeriods is now 1
      const firstMissedCount = await logic.missedPeriods();
      expect(firstMissedCount).to.equal(1);

      // Evaluate default again - this should NOT increment missedPeriods again
      await logic.evaluateDefault(await time.latest());

      // Check that missedPeriods is still 1, not 2
      const secondMissedCount = await logic.missedPeriods();
      expect(secondMissedCount).to.equal(1);
    });
  });
});
