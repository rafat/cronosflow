// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "../RWACommonTypes.sol";

/// @notice High‑level cashflow health used by the Agent
enum CashflowHealth {
    PERFORMING,
    GRACE_PERIOD,
    LATE,
    DEFAULTED,
    COMPLETED
}

/// @notice Expected / actual payment state for a given period
struct PaymentStatus {
    uint256 expectedAmount;        // Expected payment for current/next period
    uint256 dueDate;               // NextPaymentDueDate for this asset
    uint256 gracePeriodEnd;        // dueDate + gracePeriod
    uint256 amountPaidThisPeriod;  // Amount already paid toward this period
    uint256 penaltyAmount;         // Computed penalty (late fees) if any
    uint256 daysPastDue;           // How many days past dueDate
    bool    isDue;                 // Payment window is open (now >= dueDate)
    bool    isPastDue;             // Now > dueDate and not fully paid
}

interface ICashFlowLogic {
    /*//////////////////////////////////////////////////////////////
                            INITIALIZATION
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev One-time setup called by AssetFactory after deployment.
     * `data` encodes asset-type-specific parameters.
     *
     * Rental example:
     *  abi.encode(
     *      uint256 rentAmount,
     *      uint256 paymentIntervalSeconds,
     *      uint256 firstPaymentDueDate,
     *      uint256 gracePeriodSeconds,
     *      uint256 expectedMaturityDate
     *  )
     *
     * Invoice example:
     *  abi.encode(
     *      uint256 totalDue,
     *      uint256 dueDate,
     *      uint256 penaltyRateBps
     *  )
     */
    function initialize(bytes calldata data) external;

    /*//////////////////////////////////////////////////////////////
                            VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Return current asset status (mirrors registry AssetStatus)
    function getAssetStatus() external view returns (RWACommonTypes.AssetStatus);

    /// @notice High‑level cashflow health (for AI agent dashboards)
    function getCashflowHealth() external view returns (CashflowHealth);

    /**
     * @dev Return expected payment state at a given timestamp.
     * The registry/X402Adapter can use this to:
     *  - compare with `expectedMonthlyPayment` stored in registry
     *  - decide whether to call `checkAndTriggerDefault` on the registry
     */
    function getExpectedPayment(uint256 timestamp)
        external
        view
        returns (PaymentStatus memory);

    /// @notice Remaining economic exposure (0 for fully repaid / matured)
    function getRemainingPrincipal() external view returns (uint256);

    /// @notice Total cash received by this logic contract for this asset
    function getTotalReceived() external view returns (uint256);

    /// @notice Contract-level scheduling info, to sync with registry fields
    function getSchedule()
        external
        view
        returns (
            uint256 nextPaymentDueDate,
            uint256 expectedPeriodicPayment,
            uint256 expectedMaturityDate
        );

    /*//////////////////////////////////////////////////////////////
                        MUTATING / STATE UPDATES
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Process incoming payment for this asset.
     * Should be called by X402Adapter *after* funds have reached the vault.
     *
     * Responsibilities:
     *  - update internal notion of amount paid this period
     *  - possibly roll `nextPaymentDueDate` forward
     *  - update internal default / late flags
     *  - return the new AssetStatus that the registry may want to mirror
     */
    function processPayment(uint256 amount, uint256 timestamp)
        external
        returns (RWACommonTypes.AssetStatus newStatus);

    /**
     * @dev Hint function for registry/X402Adapter before default.
     * Implementations may:
     *  - compute days past due vs grace period
     *  - decide whether the asset should transition to DEFAULTED
     *  - return (newStatus, health) so registry can update its own fields
     *
     * NOTE: This does not need to mutate registry; it only updates
     *       *internal* logic state and informs the caller.
     */
    function evaluateDefault(uint256 timestamp)
        external
        returns (RWACommonTypes.AssetStatus newStatus, CashflowHealth newHealth);

    /**
     * @dev View-only preview of default/health outcome at `timestamp`.
     * Does not mutate state.
     */
    function previewDefault(uint256 timestamp)
        external
        view
        returns (
            RWACommonTypes.AssetStatus newStatus,
            CashflowHealth newHealth,
            uint256 daysPastDue,
            uint256 period
        );

    /**
     * @dev Explicit default trigger, e.g. after off‑chain/legal decision.
     * Returns true if state moved into DEFAULTED.
     */
    function forceDefault() external returns (bool);

    /**
     * @dev Mark asset as fully settled/matured (e.g., lease end or invoice paid).
     * Implementations should set internal status to COMPLETED / EXPIRED.
     */
    function markMatured(uint256 timestamp) external;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event CashflowInitialized(address indexed logic, bytes data);

    event CashflowPaymentProcessed(
        uint256 amount,
        uint256 timestamp,
        RWACommonTypes.AssetStatus newStatus,
        CashflowHealth health
    );

    event CashflowStatusUpdated(
        RWACommonTypes.AssetStatus oldStatus,
        RWACommonTypes.AssetStatus newStatus,
        CashflowHealth health,
        uint256 timestamp
    );

    event CashflowMatured(uint256 timestamp);

    event CashflowDefaultEvaluated(
        uint256 daysPastDue,
        bool defaultTriggered,
        uint256 timestamp
    );
}
