import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import hre from "hardhat";

describe("RentalCashFlowLogic", function () {
  async function deployFixture() {
    const [registrySigner] = await hre.ethers.getSigners();

    const Logic = await hre.ethers.getContractFactory("RentalCashFlowLogic");
    const logic = await Logic.deploy();

    const rentAmount = hre.ethers.parseUnits("1000", 18);

    const DAY = 24 * 60 * 60;
    const timeUnitSeconds = DAY;
    const paymentInterval = 30 * timeUnitSeconds;
    const gracePeriodUnits = 5;

    const firstDue = (await time.latest()) + 60;
    const leaseEndDate = firstDue + 180 * DAY; // ~6 months

    const registry = registrySigner.address;

    const initData = hre.ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256", "uint256", "uint256", "uint256", "uint256", "address"],
      [rentAmount, paymentInterval, firstDue, gracePeriodUnits, leaseEndDate, timeUnitSeconds, registry]
    );

    await logic.initialize(initData);

    return {
      logic,
      rentAmount,
      paymentInterval,
      gracePeriodUnits,
      leaseEndDate,
      firstDue,
      registrySigner,
      timeUnitSeconds
    };
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

      await expect(
        logic.connect(registrySigner).processPayment(rentAmount, await time.latest())
      ).not.to.be.reverted;

      expect(await logic.getTotalReceived()).to.equal(rentAmount);
    });
  });

  describe("Late & default logic (preview)", function () {
    it("previews GRACE_PERIOD after due date", async function () {
      const { logic, firstDue } = await loadFixture(deployFixture);

      await time.increaseTo(firstDue + 1);

      const [, health] = await logic.previewDefault(await time.latest());
      expect(health).to.equal(1); // GRACE_PERIOD
    });

    it("previews LATE after grace period", async function () {
      const { logic, gracePeriodUnits, firstDue, timeUnitSeconds } = await loadFixture(deployFixture);

      const t0 = firstDue + gracePeriodUnits * timeUnitSeconds + 1;
      await time.increaseTo(t0);

      const [, health] = await logic.previewDefault(await time.latest());
      expect(health).to.equal(2); // LATE
    });

    it("previews DEFAULTED after two missed periods", async function () {
      const { logic, paymentInterval, gracePeriodUnits, firstDue, timeUnitSeconds } =
        await loadFixture(deployFixture);

      // past grace for first period → LATE
      const t0 = firstDue + gracePeriodUnits * timeUnitSeconds + 1;
      await time.increaseTo(t0);

      let [status0, health0] = await logic.previewDefault(await time.latest());
      expect(health0).to.equal(2); // LATE
      expect(status0).to.equal(2); // ACTIVE

      // past grace for second period → DEFAULTED
      const t1 = firstDue + paymentInterval + gracePeriodUnits * timeUnitSeconds + 1;
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

  describe("Compressed timeline via timeUnit", function () {
    it("scales grace and lateness when timeUnit = 1 minute", async function () {
      const [registrySigner] = await hre.ethers.getSigners();

      const Logic = await hre.ethers.getContractFactory("RentalCashFlowLogic");
      const logic = await Logic.deploy();

      const rentAmount = hre.ethers.parseUnits("1000", 18);

      const MINUTE = 60;
      const timeUnitSeconds = MINUTE;
      const paymentInterval = 30 * timeUnitSeconds; // 30 minutes
      const gracePeriodUnits = 5; // 5 minutes

      const firstDue = (await time.latest()) + 10; // 10s from now
      const leaseEndDate = firstDue + 2 * paymentInterval;

      const initData = hre.ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint256", "uint256", "uint256", "uint256", "uint256", "address"],
        [rentAmount, paymentInterval, firstDue, gracePeriodUnits, leaseEndDate, timeUnitSeconds, registrySigner.address]
      );

      await logic.initialize(initData);

      // right after due date: GRACE_PERIOD
      await time.increaseTo(firstDue + 1);
      let [, health0, unitsPastDue0] = await logic.previewDefault(await time.latest());
      expect(health0).to.equal(1); // GRACE_PERIOD
      expect(unitsPastDue0).to.equal(0);

      // move past grace → LATE
      const afterGrace = firstDue + gracePeriodUnits * MINUTE + 1;
      await time.increaseTo(afterGrace);

      let [, health1, unitsPastDue1] = await logic.previewDefault(await time.latest());
      expect(health1).to.equal(2); // LATE
      expect(unitsPastDue1).to.be.gte(gracePeriodUnits);
    });
  });
});