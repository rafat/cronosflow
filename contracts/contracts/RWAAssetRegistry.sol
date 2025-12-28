// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./RWACommonTypes.sol";
import "./interface/ICashFlowLogic.sol";

contract RWAAssetRegistry is AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant ASSET_FACTORY_ROLE = keccak256("ASSET_FACTORY");
    bytes32 public constant ASSET_MANAGER_ROLE = keccak256("ASSET_MANAGER");
    bytes32 public constant PAYMENT_COLLECTOR_ROLE = keccak256("PAYMENT_COLLECTOR");
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_OFFICER");
    bytes32 public constant EMERGENCY_ADMIN_ROLE = keccak256("EMERGENCY_ADMIN");

    struct RealWorldAsset {
        uint256 assetId;
        RWACommonTypes.AssetType assetType;
        address originator;

        address logicContract;
        address vaultContract;
        address tokenContract;

        bool isKYCVerified;
        bool isPaused;

        uint256 assetValue;
        uint256 accumulatedYield;
        uint256 lastValuationDate;
        uint256 lastPaymentDate;
        uint256 missedPayments;
        uint256 daysInDefault;
        uint256 lastYieldDistributionDate;
        uint256 totalYieldDistributed;
        uint256 nextPaymentDueDate;
        uint256 expectedMonthlyPayment;
        uint256 expectedMaturityDate;
        address valuationOracle;

        RWACommonTypes.AssetStatus currentStatus;
        RWACommonTypes.AssetStatus statusBeforePause;
        uint256 registrationDate;
        uint256 activationDate;

        string ipfsMetadataHash;
    }

    mapping(uint256 => RealWorldAsset) public assets;
    uint256 public assetCounter;

    mapping(address => bool) public kycVerified;
    mapping(address => bool) public whitelistedRecipients;
    mapping(address => bool) public trustedOracles;

    uint256 public defaultThresholdDays = 30;
    uint256 public liquidationThresholdDays = 60;

    event AssetRegistered(uint256 indexed assetId, RWACommonTypes.AssetType assetType, address indexed originator, uint256 assetValue);
    event ContractsLinked(uint256 indexed assetId, address logicContract, address vaultContract, address tokenContract);
    event AssetActivated(uint256 indexed assetId, uint256 activationDate);
    event PaymentRecorded(uint256 indexed assetId, uint256 paymentAmount, uint256 accumulatedYield, uint256 timestamp);
    event DefaultTriggered(uint256 indexed assetId, uint256 missedPayments, uint256 daysInDefault, uint256 timestamp);
    event LiquidationInitiated(uint256 indexed assetId, uint256 daysInDefault, uint256 timestamp);
    event LiquidationCompleted(uint256 indexed assetId, uint256 timestamp);
    event YieldDistributed(uint256 indexed assetId, uint256 yieldAmount, uint256 timestamp);
    event ValuationUpdated(uint256 indexed assetId, uint256 oldValuation, uint256 newValuation, address indexed oracle);

    event KYCVerified(address indexed entity);
    event RecipientWhitelisted(address indexed recipient);
    event RecipientUnwhitelisted(address indexed recipient);
    event OracleAdded(address indexed oracle);
    event AssetPaused(uint256 indexed assetId, address indexed by, uint256 timestamp);
    event AssetUnpaused(uint256 indexed assetId, address indexed by, uint256 timestamp);

    constructor(address admin) {
        require(admin != address(0), "Invalid admin");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(EMERGENCY_ADMIN_ROLE, admin);
    }

    function registerAsset(
        RWACommonTypes.AssetType _assetType,
        address _originator,
        uint256 _assetValue,
        string calldata _ipfsMetadataHash
    ) external onlyRole(ASSET_FACTORY_ROLE) returns (uint256 assetId) {
        require(_assetValue > 0, "Asset value must be positive");
        require(kycVerified[_originator], "Asset originator must pass KYC");

        assetCounter++;
        assetId = assetCounter;

        RealWorldAsset storage newAsset = assets[assetId];

        newAsset.assetId = assetId;
        newAsset.assetType = _assetType;
        newAsset.originator = _originator;
        newAsset.assetValue = _assetValue;
        newAsset.ipfsMetadataHash = _ipfsMetadataHash;

        newAsset.registrationDate = block.timestamp;
        newAsset.currentStatus = RWACommonTypes.AssetStatus.REGISTERED;
        newAsset.isKYCVerified = true;

        newAsset.lastPaymentDate = block.timestamp;
        newAsset.lastValuationDate = block.timestamp;
        newAsset.missedPayments = 0;
        newAsset.daysInDefault = 0;
        newAsset.nextPaymentDueDate = block.timestamp + 30 days;

        emit AssetRegistered(assetId, _assetType, _originator, _assetValue);
        return assetId;
    }

    function linkContracts(
        uint256 _assetId,
        address _logicContract,
        address _vaultContract,
        address _token
    ) external onlyRole(ASSET_FACTORY_ROLE) nonReentrant {
        RealWorldAsset storage asset = assets[_assetId];
        require(asset.assetId != 0, "Asset does not exist");
        require(asset.currentStatus == RWACommonTypes.AssetStatus.REGISTERED, "Asset not registered");
        require(_logicContract != address(0), "Invalid logic contract");
        require(_vaultContract != address(0), "Invalid vault contract");
        require(_token != address(0), "Invalid token");

        asset.logicContract = _logicContract;
        asset.vaultContract = _vaultContract;
        asset.tokenContract = _token;
        asset.currentStatus = RWACommonTypes.AssetStatus.LINKED;

        emit ContractsLinked(_assetId, _logicContract, _vaultContract, _token);
    }

    function activateAsset(uint256 _assetId) external onlyRole(COMPLIANCE_ROLE) {
        RealWorldAsset storage asset = assets[_assetId];
        require(asset.assetId != 0, "Asset does not exist");
        require(!asset.isPaused, "Asset paused");
        require(asset.currentStatus == RWACommonTypes.AssetStatus.LINKED, "Asset not linked");
        require(asset.isKYCVerified, "KYC not verified");
        require(asset.logicContract != address(0), "Contracts not linked");
        require(asset.vaultContract != address(0), "Vault not linked");
        require(asset.tokenContract != address(0), "Token not linked");

        asset.currentStatus = RWACommonTypes.AssetStatus.ACTIVE;
        asset.activationDate = block.timestamp;

        emit AssetActivated(_assetId, block.timestamp);
    }

    /**
     * UPDATED: recordPayment now also updates the logic contract
     */
    function recordPayment(uint256 _assetId, uint256 _paymentAmount)
        external
        onlyRole(PAYMENT_COLLECTOR_ROLE)
        nonReentrant
    {
        RealWorldAsset storage asset = assets[_assetId];
        require(asset.assetId != 0, "Asset does not exist");
        require(asset.currentStatus == RWACommonTypes.AssetStatus.ACTIVE, "Asset not active");
        require(_paymentAmount > 0, "Payment must be positive");
        require(!asset.isPaused, "Asset paused");
        require(asset.logicContract != address(0), "Logic not linked");

        // Inform logic FIRST (so schedule/health stay consistent)
        ICashFlowLogic(asset.logicContract).processPayment(_paymentAmount, block.timestamp);

        asset.lastPaymentDate = block.timestamp;
        asset.accumulatedYield += _paymentAmount;
        asset.daysInDefault = 0;
        asset.nextPaymentDueDate = block.timestamp + 30 days;

        if (_paymentAmount >= asset.expectedMonthlyPayment) {
            asset.missedPayments = 0;
        }

        emit PaymentRecorded(_assetId, _paymentAmount, asset.accumulatedYield, block.timestamp);
    }

    function checkAndTriggerDefault(uint256 _assetId)
        external
        nonReentrant
        returns (bool triggered)
    {
        RealWorldAsset storage asset = assets[_assetId];
        require(asset.assetId != 0, "Asset does not exist");
        require(!asset.isPaused, "Asset paused");

        // Only evaluate for assets that can evolve due to cashflow checks
        // (Tune this to your desired lifecycle.)
        if (
            asset.currentStatus != RWACommonTypes.AssetStatus.ACTIVE &&
            asset.currentStatus != RWACommonTypes.AssetStatus.UNDER_REVIEW
        ) {
            return false;
        }

        address logicAddr = asset.logicContract;
        require(logicAddr != address(0), "Logic not linked");

        // Ask the asset-specific logic contract to evaluate health/status at this time.
        (RWACommonTypes.AssetStatus newStatus, CashflowHealth newHealth) =
            ICashFlowLogic(logicAddr).evaluateDefault(block.timestamp);

        // Pull schedule info so registry stays in sync for UI/agents
        (
            uint256 nextDueDate,
            uint256 expectedPeriodicPayment,
            uint256 maturityDate
        ) = ICashFlowLogic(logicAddr).getSchedule();

        asset.nextPaymentDueDate = nextDueDate;
        asset.expectedMonthlyPayment = expectedPeriodicPayment;
        asset.expectedMaturityDate = maturityDate;

        // Update observability fields
        // If logic says DEFAULTED or LIQUIDATING, compute days past due from nextDueDate.
        uint256 daysPastDue = 0;
        if (block.timestamp > nextDueDate) {
            daysPastDue = (block.timestamp - nextDueDate) / 1 days;
        }
        asset.daysInDefault = daysPastDue;

        // Mirror status if changed
        RWACommonTypes.AssetStatus oldStatus = asset.currentStatus;
        if (newStatus != oldStatus) {
            asset.currentStatus = newStatus;
        }

        // Heuristic: track missedPayments based on logic health transitions.
        // Because registry doesn’t know period indexes, it should not try to reproduce
        // the logic’s “missed period counting”. We just increment when we newly enter
        // a “bad” state from a non-bad state.
        bool isBadHealth =
            (newHealth == CashflowHealth.LATE || newHealth == CashflowHealth.DEFAULTED);

        bool wasBadStatus =
            (oldStatus == RWACommonTypes.AssetStatus.DEFAULTED ||
            oldStatus == RWACommonTypes.AssetStatus.LIQUIDATING);

        if (isBadHealth && !wasBadStatus) {
            asset.missedPayments += 1;
        }

        // Emit events / return whether Track-2 action should run
        // Default / liquidation are the actionable states.
        if (newStatus == RWACommonTypes.AssetStatus.DEFAULTED) {
            emit DefaultTriggered(_assetId, asset.missedPayments, daysPastDue, block.timestamp);
            return true;
        }

        if (newStatus == RWACommonTypes.AssetStatus.LIQUIDATING) {
            emit LiquidationInitiated(_assetId, daysPastDue, block.timestamp);
            return true;
        }

        // If completed/expired, nothing to trigger.
        return false;
    }


    function completeLiquidation(uint256 _assetId) external onlyRole(EMERGENCY_ADMIN_ROLE) {
        RealWorldAsset storage asset = assets[_assetId];
        require(asset.assetId != 0, "Asset does not exist");
        require(asset.currentStatus == RWACommonTypes.AssetStatus.LIQUIDATING, "Not in liquidation");

        asset.currentStatus = RWACommonTypes.AssetStatus.LIQUIDATED;
        emit LiquidationCompleted(_assetId, block.timestamp);
    }

    function recordYieldDistribution(uint256 _assetId, uint256 _yield)
        external
        onlyRole(ASSET_MANAGER_ROLE)
        nonReentrant
    {
        RealWorldAsset storage asset = assets[_assetId];
        require(asset.assetId != 0, "Asset does not exist");
        require(_yield <= asset.accumulatedYield, "Insufficient accumulated yield");

        asset.accumulatedYield -= _yield;
        asset.lastYieldDistributionDate = block.timestamp;
        asset.totalYieldDistributed += _yield;

        emit YieldDistributed(_assetId, _yield, block.timestamp);
    }

    function updateValuation(uint256 _assetId, uint256 _newValuation) external nonReentrant {
        RealWorldAsset storage asset = assets[_assetId];
        require(trustedOracles[msg.sender], "Untrusted oracle");
        require(asset.assetId != 0, "Asset does not exist");
        require(_newValuation > 0, "Valuation must be positive");

        uint256 maxChange = (asset.assetValue * 10) / 100;
        require(
            _newValuation <= asset.assetValue + maxChange &&
            _newValuation >= asset.assetValue - maxChange,
            "Valuation change exceeds 10% limit"
        );

        uint256 oldValuation = asset.assetValue;
        asset.assetValue = _newValuation;
        asset.lastValuationDate = block.timestamp;
        asset.valuationOracle = msg.sender;

        emit ValuationUpdated(_assetId, oldValuation, _newValuation, msg.sender);
    }

    function verifyKYC(address _address) external onlyRole(COMPLIANCE_ROLE) {
        require(_address != address(0), "Invalid address");
        kycVerified[_address] = true;
        emit KYCVerified(_address);
    }

    function whitelistRecipient(address recipient) external onlyRole(COMPLIANCE_ROLE) {
        require(recipient != address(0), "Invalid recipient");
        require(kycVerified[recipient], "Recipient must be KYC verified");
        whitelistedRecipients[recipient] = true;
        emit RecipientWhitelisted(recipient);
    }

    function unwhitelistRecipient(address recipient) external onlyRole(COMPLIANCE_ROLE) {
        require(recipient != address(0), "Invalid recipient");
        whitelistedRecipients[recipient] = false;
        emit RecipientUnwhitelisted(recipient);
    }

    function addTrustedOracle(address _oracle) external onlyRole(EMERGENCY_ADMIN_ROLE) {
        require(_oracle != address(0), "Invalid oracle");
        trustedOracles[_oracle] = true;
        emit OracleAdded(_oracle);
    }

    function pauseAsset(uint256 _assetId) external onlyRole(EMERGENCY_ADMIN_ROLE) {
        RealWorldAsset storage asset = assets[_assetId];
        require(asset.assetId != 0, "Asset does not exist");
        require(!asset.isPaused, "Asset already paused");

        asset.isPaused = true;
        asset.statusBeforePause = asset.currentStatus;
        asset.currentStatus = RWACommonTypes.AssetStatus.PAUSED;

        emit AssetPaused(_assetId, msg.sender, block.timestamp);
    }

    function unpauseAsset(uint256 _assetId) external onlyRole(EMERGENCY_ADMIN_ROLE) {
        RealWorldAsset storage asset = assets[_assetId];
        require(asset.assetId != 0, "Asset does not exist");
        require(asset.isPaused, "Asset not paused");

        asset.isPaused = false;
        asset.currentStatus = asset.statusBeforePause;

        emit AssetUnpaused(_assetId, msg.sender, block.timestamp);
    }

    function isAssetActive(uint256 _assetId) public view returns (bool) {
        return assets[_assetId].currentStatus == RWACommonTypes.AssetStatus.ACTIVE;
    }

    function isAssetPaused(uint256 _assetId) external view returns (bool) {
        RealWorldAsset storage asset = assets[_assetId];
        require(asset.assetId != 0, "Asset does not exist");
        return asset.isPaused;
    }

    function isWhitelisted(address _recipient) external view returns (bool) {
        return whitelistedRecipients[_recipient];
    }
}