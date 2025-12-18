// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interface/ICashFlowLogic.sol";
import "./RWACommonTypes.sol";

/**
 * @title RentalCashflowLogic
 * @dev Cashflow engine for monthly rental agreements.
 *
 * Responsibilities:
 * - Track rent schedule
 * - Track which rental periods are paid
 * - Compute lateness / default signals
 * - Expose expected payment info for agents & adapters
 *
 * Does NOT:
 * - Move funds
 * - Distribute yield
 * - Liquidate assets
 */
contract RentalCashFlowLogic is ICashFlowLogic {
    // =============================================================
    // Lease Parameters (Immutable after init)
    // =============================================================

    uint256 public rentAmount;            // Monthly rent
    uint256 public paymentInterval;       // Seconds per rent period (≈30 days)
    uint256 public gracePeriodDays;        // Grace period after due date
    uint256 public leaseEndDate;           // Lease maturity timestamp

    // =============================================================
    // Internal Cashflow State
    // =============================================================

    CashflowHealth public health;

    // Tracks paid rental periods (period index => paid)
    mapping(uint256 => bool) public periodPaid;

    uint256 public startTimestamp;
    uint256 public lastPaidPeriod;
    uint256 public totalAmountPaid;
    uint256 public missedPeriods;
    uint256 public lastMissedPeriod;

    bool public initialized;

    // =============================================================
    // Events
    // =============================================================

    event LeaseInitialized(
        uint256 rentAmount,
        uint256 paymentInterval,
        uint256 gracePeriodDays,
        uint256 leaseEndDate
    );

    event RentPaid(uint256 indexed period, uint256 amount, uint256 timestamp);
    event CashflowHealthUpdated(CashflowHealth newHealth);

    // =============================================================
    // Initialization
    // =============================================================

    /**
     * @dev data = abi.encode(
     *   rentAmount,
     *   paymentIntervalSeconds (e.g. 30 days),
     *   gracePeriodDays,
     *   leaseEndDate
     * )
     */
    function initialize(bytes calldata data) external override {
        require(!initialized, "Already initialized");

        (
            rentAmount,
            paymentInterval,
            gracePeriodDays,
            leaseEndDate
        ) = abi.decode(data, (uint256, uint256, uint256, uint256));

        require(rentAmount > 0, "Invalid rent");
        require(paymentInterval >= 28 days, "Interval too short");
        require(leaseEndDate > block.timestamp, "Lease already ended");

        startTimestamp = block.timestamp;
        health = CashflowHealth.PERFORMING;
        initialized = true;

        emit LeaseInitialized(
            rentAmount,
            paymentInterval,
            gracePeriodDays,
            leaseEndDate
        );
    }

    // =============================================================
    // Views (ICashflowLogic)
    // =============================================================

    function getAssetStatus()
        public
        view
        override
        returns (RWACommonTypes.AssetStatus)
    {
        if (health == CashflowHealth.DEFAULTED) {
            return RWACommonTypes.AssetStatus.DEFAULTED;
        }
        if (health == CashflowHealth.COMPLETED) {
            return RWACommonTypes.AssetStatus.EXPIRED;
        }
        return RWACommonTypes.AssetStatus.ACTIVE;
    }

    function getCashflowHealth()
        external
        view
        override
        returns (CashflowHealth)
    {
        return health;
    }

    function getExpectedPayment(uint256 timestamp)
        external
        view
        override
        returns (PaymentStatus memory)
    {
        uint256 currentPeriod = _periodAt(timestamp);
        uint256 dueDate = _dueDateForPeriod(currentPeriod);

        bool paid = periodPaid[currentPeriod];

        uint256 daysPastDue = 0;
        if (!paid && timestamp > dueDate) {
            daysPastDue = (timestamp - dueDate) / 1 days;
        }

        return PaymentStatus({
            expectedAmount: rentAmount,
            dueDate: dueDate,
            gracePeriodEnd: dueDate + (gracePeriodDays * 1 days),
            amountPaidThisPeriod: paid ? rentAmount : 0,
            daysPastDue: daysPastDue,
            penaltyAmount: 0,
            isDue: timestamp >= dueDate && !paid,
            isPastDue: daysPastDue > gracePeriodDays
        });
    }

    function getRemainingPrincipal()
        external
        pure
        override
        returns (uint256)
    {
        // Rentals are recurring — no remaining principal
        return 0;
    }

    function getTotalReceived()
        external
        view
        override
        returns (uint256)
    {
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

    // =============================================================
    // State Updates
    // =============================================================

    function processPayment(uint256 amount, uint256 timestamp)
        external
        override
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
        returns (RWACommonTypes.AssetStatus, CashflowHealth)
    {
        require(initialized, "Not initialized");

        // Lease ended → completed
        if (timestamp >= leaseEndDate) {
            health = CashflowHealth.COMPLETED;
            emit CashflowHealthUpdated(health);
            return (RWACommonTypes.AssetStatus.EXPIRED, health);
        }

        uint256 period = _periodAt(timestamp);
        uint256 dueDate = _dueDateForPeriod(period);

        // Payment already made for this period → healthy
        if (periodPaid[period]) {
            health = CashflowHealth.PERFORMING;
            return (RWACommonTypes.AssetStatus.ACTIVE, health);
        }

        uint256 daysPastDue =
            timestamp > dueDate ? (timestamp - dueDate) / 1 days : 0;

        // Still within grace period
        if (daysPastDue < gracePeriodDays) {
            health = CashflowHealth.GRACE_PERIOD;
            emit CashflowHealthUpdated(health);
            return (RWACommonTypes.AssetStatus.ACTIVE, health);
        }

        // ❗ Past grace period: count missed period ONCE
        if (lastMissedPeriod < period) {
            lastMissedPeriod = period;
            missedPeriods += 1;
        }

        if (missedPeriods >= 2) {
            health = CashflowHealth.DEFAULTED;
        } else {
            health = CashflowHealth.LATE;
        }

        emit CashflowHealthUpdated(health);
        return (getAssetStatus(), health);
    }


    function forceDefault()
        external
        override
        returns (bool)
    {
        health = CashflowHealth.DEFAULTED;
        emit CashflowHealthUpdated(health);
        return true;
    }

    function markMatured(uint256)
        external
        override
    {
        health = CashflowHealth.COMPLETED;
        emit CashflowHealthUpdated(health);
    }

    // =============================================================
    // Internal Helpers
    // =============================================================

    function _periodAt(uint256 timestamp)
        internal
        view
        returns (uint256)
    {
        if (timestamp < startTimestamp) {
            return 0;
        }
        return (timestamp - startTimestamp) / paymentInterval;
    }

    function _dueDateForPeriod(uint256 period)
        internal
        view
        returns (uint256)
    {
        return startTimestamp + (period * paymentInterval);
    }
}
