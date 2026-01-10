// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interface/ICashFlowLogic.sol";
import "./RWACommonTypes.sol";

contract RentalCashFlowLogic is ICashFlowLogic {
    uint256 public rentAmount;
    uint256 public paymentInterval;     // in seconds, multiple of timeUnit
    uint256 public gracePeriodUnits;    // number of timeUnit steps as grace period
    uint256 public leaseEndDate;        // timestamp
    uint256 public timeUnit;            // e.g. 1 days in prod, 1 minutes or 1 seconds in demo

    CashflowHealth public health;

    mapping(uint256 => bool) public periodPaid;

    uint256 public startTimestamp;
    uint256 public lastPaidPeriod;
    uint256 public totalAmountPaid;
    uint256 public missedPeriods;
    uint256 public lastMissedPeriod;

    bool public initialized;

    event LeaseInitialized(
        uint256 rentAmount,
        uint256 paymentInterval,
        uint256 firstPaymentDueDate,
        uint256 gracePeriodUnits,
        uint256 leaseEndDate,
        uint256 timeUnit
    );

    event RentPaid(uint256 indexed period, uint256 amount, uint256 timestamp);
    event CashflowHealthUpdated(CashflowHealth newHealth);

    address public registry;
    modifier onlyRegistry() {
        require(msg.sender == registry, "Only registry");
        _;
    }

    /**
     * NEW ENCODING:
     *
     * Rental example:
     *  abi.encode(
     *      uint256 rentAmount,
     *      uint256 paymentIntervalSeconds,
     *      uint256 firstPaymentDueDate,
     *      uint256 gracePeriodUnits,
     *      uint256 expectedMaturityDate,
     *      uint256 timeUnitSeconds,
     *      address registry
     *  )
     *
     * In prod:  timeUnitSeconds = 1 days
     * In demo:  timeUnitSeconds = 1 minutes (or 1 seconds)
     */
    function initialize(bytes calldata data) external override {
        require(!initialized, "Already initialized");

        uint256 firstPaymentDueDate;
        uint256 timeUnitSeconds;

        (
            rentAmount,
            paymentInterval,
            firstPaymentDueDate,
            gracePeriodUnits,
            leaseEndDate,
            timeUnitSeconds,
            registry
        ) = abi.decode(data, (uint256, uint256, uint256, uint256, uint256, uint256, address));

        require(rentAmount > 0, "Invalid rent");
        require(timeUnitSeconds > 0, "Invalid timeUnit");
        require(paymentInterval >= 28 * timeUnitSeconds, "Interval too short");
        require(registry != address(0), "Invalid registry");

        require(firstPaymentDueDate + 5 * timeUnitSeconds >= block.timestamp, "First due date too far in past");
        require(leaseEndDate > firstPaymentDueDate, "Lease end before first due");

        startTimestamp = firstPaymentDueDate;
        timeUnit = timeUnitSeconds;
        health = CashflowHealth.PERFORMING;
        initialized = true;

        emit LeaseInitialized(
            rentAmount,
            paymentInterval,
            firstPaymentDueDate,
            gracePeriodUnits,
            leaseEndDate,
            timeUnit
        );
    }

    function getAssetStatus() public view override returns (RWACommonTypes.AssetStatus) {
        if (health == CashflowHealth.DEFAULTED) return RWACommonTypes.AssetStatus.DEFAULTED;
        if (health == CashflowHealth.COMPLETED) return RWACommonTypes.AssetStatus.EXPIRED;
        return RWACommonTypes.AssetStatus.ACTIVE;
    }

    function getCashflowHealth() external view override returns (CashflowHealth) {
        return health;
    }

    function getExpectedPayment(uint256 timestamp) external view override returns (PaymentStatus memory) {
        uint256 currentPeriod = _periodAt(timestamp);
        uint256 dueDate = _dueDateForPeriod(currentPeriod);
        bool paid = periodPaid[currentPeriod];

        uint256 unitsPastDue = 0;
        if (!paid && timestamp > dueDate) {
            unitsPastDue = (timestamp - dueDate) / timeUnit;
        }

        return PaymentStatus({
            expectedAmount: rentAmount,
            dueDate: dueDate,
            gracePeriodEnd: dueDate + (gracePeriodUnits * timeUnit),
            amountPaidThisPeriod: paid ? rentAmount : 0,
            penaltyAmount: 0,
            daysPastDue: unitsPastDue, // interpreted as "timeUnit steps"
            isDue: timestamp >= dueDate && !paid,
            isPastDue: unitsPastDue > gracePeriodUnits
        });
    }

    function getRemainingPrincipal() external pure override returns (uint256) {
        return 0;
    }

    function getTotalReceived() external view override returns (uint256) {
        return totalAmountPaid;
    }

    function getSchedule()
        external
        view
        override
        returns (
            uint256 nextDueDate,
            uint256 expectedPeriodicPayment,
            uint256 maturityDate
        )
    {
        nextDueDate = _dueDateForPeriod(_periodAt(block.timestamp));
        expectedPeriodicPayment = rentAmount;
        maturityDate = leaseEndDate;
    }

    function processPayment(uint256 amount, uint256 timestamp)
        external
        override
        onlyRegistry
        returns (RWACommonTypes.AssetStatus)
    {
        require(initialized, "Not initialized");
        require(health != CashflowHealth.DEFAULTED, "Already defaulted");
        require(timestamp <= leaseEndDate, "Lease expired");
        require(amount >= rentAmount, "Insufficient payment");

        uint256 period = _periodAt(timestamp);
        require(!periodPaid[period], "Period already paid");

        periodPaid[period] = true;
        lastPaidPeriod = period;
        totalAmountPaid += amount;

        health = CashflowHealth.PERFORMING;
        emit RentPaid(period, amount, timestamp);
        emit CashflowHealthUpdated(health);

        if (timestamp >= leaseEndDate) {
            health = CashflowHealth.COMPLETED;
            emit CashflowHealthUpdated(health);
        }

        return getAssetStatus();
    }

    function evaluateDefault(uint256 timestamp)
        external
        override
        onlyRegistry
        returns (RWACommonTypes.AssetStatus, CashflowHealth)
    {
        (RWACommonTypes.AssetStatus newStatus, CashflowHealth newHealth,, uint256 period) =
            this.previewDefault(timestamp);

        CashflowHealth oldHealth = health;
        health = newHealth;

        if (newHealth == CashflowHealth.LATE || newHealth == CashflowHealth.DEFAULTED) {
            missedPeriods = _countMissedPeriodsUpTo(period, timestamp);
            lastMissedPeriod = period;
        }

        if (oldHealth != newHealth) emit CashflowHealthUpdated(newHealth);
        return (newStatus, newHealth);
    }

    function previewDefault(uint256 timestamp)
        external
        view
        override
        returns (
            RWACommonTypes.AssetStatus newStatus,
            CashflowHealth newHealth,
            uint256 daysPastDue,
            uint256 period
        )
    {
        require(initialized, "Not initialized");

        if (timestamp >= leaseEndDate) {
            return (RWACommonTypes.AssetStatus.EXPIRED, CashflowHealth.COMPLETED, 0, _periodAt(timestamp));
        }

        period = _periodAt(timestamp);
        uint256 dueDate = _dueDateForPeriod(period);

        if (periodPaid[period]) {
            return (RWACommonTypes.AssetStatus.ACTIVE, CashflowHealth.PERFORMING, 0, period);
        }

        daysPastDue = timestamp > dueDate ? (timestamp - dueDate) / timeUnit : 0;

        if (daysPastDue < gracePeriodUnits) {
            return (RWACommonTypes.AssetStatus.ACTIVE, CashflowHealth.GRACE_PERIOD, daysPastDue, period);
        }

        uint256 missed = _countMissedPeriodsUpTo(period, timestamp);

        if (missed >= 2) {
            return (RWACommonTypes.AssetStatus.DEFAULTED, CashflowHealth.DEFAULTED, daysPastDue, period);
        }

        return (RWACommonTypes.AssetStatus.ACTIVE, CashflowHealth.LATE, daysPastDue, period);
    }

    // FIXED: no longer permissionless
    function forceDefault() external override onlyRegistry returns (bool) {
        health = CashflowHealth.DEFAULTED;
        emit CashflowHealthUpdated(health);
        return true;
    }

    function markMatured(uint256) external override {
        health = CashflowHealth.COMPLETED;
        emit CashflowHealthUpdated(health);
    }

    function _periodAt(uint256 timestamp) internal view returns (uint256) {
        if (timestamp < startTimestamp) return 0;
        return (timestamp - startTimestamp) / paymentInterval;
    }

    function _dueDateForPeriod(uint256 period) internal view returns (uint256) {
        return startTimestamp + (period * paymentInterval);
    }

    function _countMissedPeriodsUpTo(uint256 currentPeriod, uint256 timestamp)
        internal
        view
        returns (uint256 missed)
    {
        for (uint256 p = 0; p <= currentPeriod; p++) {
            if (periodPaid[p]) continue;

            uint256 due = _dueDateForPeriod(p);
            uint256 unitsPastDue = timestamp > due ? (timestamp - due) / timeUnit : 0;

            if (unitsPastDue >= gracePeriodUnits) missed++;
        }
    }
}