// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interface/ICashFlowLogic.sol";
import "../RWACommonTypes.sol";

contract DefaultingLogicMock is ICashFlowLogic {
    function initialize(bytes calldata) external override {}

    function getAssetStatus() external pure override returns (RWACommonTypes.AssetStatus) {
        return RWACommonTypes.AssetStatus.DEFAULTED;
    }

    function getCashflowHealth() external pure override returns (CashflowHealth) {
        return CashflowHealth.DEFAULTED;
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
            isPastDue: true
        });
    }

    function getRemainingPrincipal() external pure override returns (uint256) { return 0; }
    function getTotalReceived() external pure override returns (uint256) { return 0; }

    function getSchedule()
        external
        pure
        override
        returns (uint256 nextPaymentDueDate, uint256 expectedPeriodicPayment, uint256 expectedMaturityDate)
    {
        return (0, 0, 0);
    }

    function processPayment(uint256, uint256) external pure override returns (RWACommonTypes.AssetStatus) {
        return RWACommonTypes.AssetStatus.ACTIVE;
    }

    function evaluateDefault(uint256) external pure override returns (RWACommonTypes.AssetStatus, CashflowHealth) {
        return (RWACommonTypes.AssetStatus.DEFAULTED, CashflowHealth.DEFAULTED);
    }

    function forceDefault() external pure override returns (bool) { return true; }
    function previewDefault(uint256)
        external
        view
        override
        returns (RWACommonTypes.AssetStatus, CashflowHealth, uint256, uint256)
    {
        return (RWACommonTypes.AssetStatus.DEFAULTED, CashflowHealth.DEFAULTED, 1000, 0);
    }
    function markMatured(uint256) external pure override {}
}