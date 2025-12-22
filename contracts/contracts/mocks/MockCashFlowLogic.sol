// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interface/ICashFlowLogic.sol";
import "../RWACommonTypes.sol";

contract MockCashFlowLogic is ICashFlowLogic {
    uint256 public expected;

    constructor(uint256 _expected) {
        expected = _expected;
    }

    function initialize(bytes calldata) external override {}

    function getAssetStatus() external pure override returns (RWACommonTypes.AssetStatus) {
        return RWACommonTypes.AssetStatus.ACTIVE;
    }

    function getCashflowHealth() external pure override returns (CashflowHealth) {
        return CashflowHealth.PERFORMING;
    }

    function getExpectedPayment(uint256) external pure override returns (PaymentStatus memory) {
        return PaymentStatus({
            expectedAmount: 0,
            dueDate: 0,
            gracePeriodEnd: 0,
            amountPaidThisPeriod: 0,
            penaltyAmount: 0,
            daysPastDue: 0,
            isDue: false,
            isPastDue: false
        });
    }

    function getRemainingPrincipal() external pure override returns (uint256) { return 0; }
    function getTotalReceived() external pure override returns (uint256) { return 0; }

    function getSchedule()
        external
        view
        override
        returns (uint256 nextPaymentDueDate, uint256 expectedPeriodicPayment, uint256 expectedMaturityDate)
    {
        return (0, expected, 0);
    }

    function processPayment(uint256, uint256) external pure override returns (RWACommonTypes.AssetStatus) {
        return RWACommonTypes.AssetStatus.ACTIVE;
    }

    function evaluateDefault(uint256) external pure override returns (RWACommonTypes.AssetStatus, CashflowHealth) {
        return (RWACommonTypes.AssetStatus.ACTIVE, CashflowHealth.PERFORMING);
    }

    function previewDefault(uint256)
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
        return (RWACommonTypes.AssetStatus.ACTIVE, CashflowHealth.PERFORMING, 0, 0);
    }

    function forceDefault() external pure override returns (bool) { return false; }
    function markMatured(uint256) external pure override {}
}