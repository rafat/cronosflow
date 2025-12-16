// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./RWACommonTypes.sol";

contract RWAAssetRegistry is AccessControl, Pausable, ReentrancyGuard {
    // === ROLE DEFINITIONS ===
    bytes32 public constant ASSET_FACTORY_ROLE = keccak256("ASSET_FACTORY");
    bytes32 public constant ASSET_MANAGER_ROLE = keccak256("ASSET_MANAGER");
    bytes32 public constant PAYMENT_COLLECTOR_ROLE = keccak256("PAYMENT_COLLECTOR");
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_OFFICER");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_FEEDER");
    bytes32 public constant EMERGENCY_ADMIN_ROLE = keccak256("EMERGENCY_ADMIN");

    struct RealWorldAsset {
        // === IDENTIFICATION ===
        uint256 assetId;                 // Unique ID (auto-increment)
        RWACommonTypes.AssetType assetType;             // REAL_ESTATE, INVOICE, BOND, COMMODITY
        address originator;            // Asset originator address

        // === CORE CONTRACTS ===
        address logicContract;           // Asset-specific logic contract
        address vaultContract;           // ERC-4626/ERC-7540 vault for capital
        address tokenContract;          // ERC-20 token representing ownership
    
        // === COMPLIANCE & SECURITY ===
        bool isKYCVerified;              // Owner/originator passed KYC
        bool isWhitelisted;              // Approved for investor participation
        bool isPaused;                   // Emergency pause flag

        // === FINANCIAL DATA ===
        uint256 assetValue;              // Current valuation (USD, 1e18 precision)
        uint256 accumulatedYield;        // Interest earned but not distributed
        uint256 lastValuationDate;       // Timestamp of last oracle update
        uint256 lastPaymentDate;         // Timestamp of most recent payment
        uint256 missedPayments;          // Count of late/missing payments
        uint256 daysInDefault;           // Number of days past due
        uint256 lastYieldDistributionDate;  // When yields last distributed
        uint256 totalYieldDistributed;      // Cumulative yield paid out
        uint256 nextPaymentDueDate;
        uint256 expectedMonthlyPayment;     // Agreed monthly payment amount
        uint256 expectedMaturityDate;    // Contract end date
        address valuationOracle;        // Last oracle to update valuation

        // === LIFECYCLE TRACKING ===
        RWACommonTypes.AssetStatus currentStatus;       // Current state in lifecycle
        uint256 registrationDate;        // When asset was registered
        uint256 activationDate;          // When asset went live

        // === ASSET METADATA ===
        string ipfsMetadataHash;         // Hash of PDF/JSON documentation
    }
    
    // === PRIMARY DATA STORE ===
    mapping(uint256 => RealWorldAsset) public assets;
    uint256 public assetCounter;

    // === COMPLIANCE TRACKING ===
    mapping(address => bool) public kycVerified;                  // KYC status

    // === ORACLE MANAGEMENT ===
    mapping(address => bool) public trustedOracles;

    // === CONFIGURATION ===
    uint256 public defaultThresholdDays = 30;  // Days before marking as defaulted
    uint256 public liquidationThresholdDays = 60;  // Days before liquidation

    // === EVENTS ===
    event AssetRegistered(
        uint256 indexed assetId,
        RWACommonTypes.AssetType assetType,
        address indexed originator,
        uint256 assetValue
    );

    event ContractsLinked(
        uint256 indexed assetId,
        address logicContract,
        address vaultContract,
        address tokenContract
    );

    event AssetActivated(
        uint256 indexed assetId,
        uint256 activationDate
    );

    event PaymentRecorded(
        uint256 indexed assetId,
        uint256 paymentAmount,
        uint256 accumulatedYield,
        uint256 timestamp
    );

    event DefaultTriggered(
        uint256 indexed assetId,
        uint256 missedPayments,
        uint256 daysInDefault,
        uint256 timestamp
    );

    event LiquidationInitiated(
        uint256 indexed assetId,
        uint256 daysInDefault,
        uint256 timestamp
    );

    event LiquidationCompleted(
        uint256 indexed assetId,
        uint256 timestamp
    );

    event YieldDistributed(
        uint256 indexed assetId,
        uint256 yieldAmount,
        uint256 timestamp
    );

    event ValuationUpdated(
        uint256 indexed assetId,
        uint256 oldValuation,
        uint256 newValuation,
        address indexed oracle
    );

    event KYCVerified(address indexed entity);
    event AssetWhitelisted(uint256 indexed assetId);
    event OracleAdded(address indexed oracle);

    constructor() {
        // Grant the deployer (you) the admin role so you can assign others later
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
    * @dev Register new real-world asset. Only callable by AssetFactory.
    * @param _assetType Category (REAL_ESTATE, INVOICE, BOND)
    * @param _assetValue Current valuation
    * @param _ipfsMetadataHash IPFS hash of metadata
    * @return assetId Newly assigned asset ID
    */
    function registerAsset(
        RWACommonTypes.AssetType _assetType,
        address _originator,
        uint256 _assetValue,
        string calldata _ipfsMetadataHash
    ) external 
        onlyRole(ASSET_FACTORY_ROLE)
        returns (uint256 assetId) 
    {
        require(_assetValue > 0, "Asset value must be positive");
        require(kycVerified[msg.sender], "Asset originator must pass KYC");
        
        // Increment counter for new asset ID
        assetId = assetCounter++;
        
        // Create new asset record
        RealWorldAsset storage newAsset = assets[assetId];
        
        newAsset.assetId = assetId;
        newAsset.assetType = _assetType;
        newAsset.originator = _originator;
        newAsset.assetValue = _assetValue;
        newAsset.ipfsMetadataHash = _ipfsMetadataHash;
        
        newAsset.registrationDate = block.timestamp;
        newAsset.currentStatus = RWACommonTypes.AssetStatus.REGISTERED;
        newAsset.isKYCVerified = true;
        
        // Initialize tracking
        newAsset.lastPaymentDate = block.timestamp;
        newAsset.lastValuationDate = block.timestamp;
        newAsset.missedPayments = 0;
        newAsset.daysInDefault = 0;
        newAsset.nextPaymentDueDate = block.timestamp + 30 days; // Example: 30 days from now


        // Emit event
        emit AssetRegistered(
            assetId,
            _assetType,
            msg.sender,
            _assetValue
        );
        
        return assetId;
    }

    /**
    * @dev Link vault & token contracts to asset. Called after factory deploys them.
    * @param _assetId Asset ID to configure
    * @param _logicContract Asset-specific logic contract
    * @param _vaultContract ERC-4626/7540 vault for capital
    * @param _token Token contract
    */
    function linkContracts(
        uint256 _assetId,
        address _logicContract,
        address _vaultContract,
        address _token
        ) external 
        onlyRole(ASSET_FACTORY_ROLE)
        nonReentrant 
    {
        RealWorldAsset storage asset = assets[_assetId];
        require(asset.assetId != 0, "Asset does not exist");
        require(asset.currentStatus == RWACommonTypes.AssetStatus.REGISTERED, "Asset already linked");
        require(_logicContract != address(0), "Invalid logic contract");
        require(_vaultContract != address(0), "Invalid vault contract");
        require(_token != address(0), "Invalid token");
        
        asset.logicContract = _logicContract;
        asset.vaultContract = _vaultContract;
        asset.tokenContract = _token;

        
        emit ContractsLinked(
            _assetId,
            _logicContract,
            _vaultContract,
            _token
        );
    }

    /**
    * @dev Activate asset for investor participation.
    * @param _assetId Asset to activate
    */
    function activateAsset(uint256 _assetId) external onlyRole(COMPLIANCE_ROLE) {
        RealWorldAsset storage asset = assets[_assetId];
        require(asset.assetId != 0, "Asset does not exist");
        require(asset.currentStatus == RWACommonTypes.AssetStatus.REGISTERED, "Asset already activated");
        require(asset.isKYCVerified, "KYC not verified");
        require(asset.isWhitelisted, "Asset not whitelisted");
        require(asset.logicContract != address(0), "Contracts not linked");

        asset.currentStatus = RWACommonTypes.AssetStatus.ACTIVE;
        asset.activationDate = block.timestamp;
            
        emit AssetActivated(_assetId, block.timestamp);
    }

    /**
    * @dev Record payment received for asset. Resets missed payment counter.
    * @param _assetId Asset ID
    * @param _paymentAmount Amount received
    */
    function recordPayment(
        uint256 _assetId,
        uint256 _paymentAmount
    ) external 
        onlyRole(PAYMENT_COLLECTOR_ROLE)
        nonReentrant 
    {
        RealWorldAsset storage asset = assets[_assetId];
        require(asset.assetId != 0, "Asset does not exist");
        require(asset.currentStatus == RWACommonTypes.AssetStatus.ACTIVE, "Asset not active");
        require(_paymentAmount > 0, "Payment must be positive");
        
        // Update payment tracking
        asset.lastPaymentDate = block.timestamp;
        asset.accumulatedYield += _paymentAmount;
        asset.daysInDefault = 0;  // CRITICAL: Reset default counter on payment
        asset.nextPaymentDueDate = block.timestamp + 30 days; // Example: next payment due in 30 days
        
        // Check if payment covers shortfall
        if (_paymentAmount >= asset.expectedMonthlyPayment) {
            asset.missedPayments = 0;  // Reset missed payments
        }
        
        emit PaymentRecorded(
            _assetId,
            _paymentAmount,
            asset.accumulatedYield,
            block.timestamp
        );
    }

    /**
    * @dev Check if asset should be marked as defaulted.
    * Called by Track 2 enforcement contract or permissionlessly.
    * RETURNS: true if default detected → triggers Track 2 workflow.
    * @param _assetId Asset to check
    * @return isDefault True if default condition met
    */
    function checkAndTriggerDefault(uint256 _assetId) external returns (bool isDefault) {
        RealWorldAsset storage asset = assets[_assetId];
        require(asset.assetId != 0, "Asset does not exist");
        
        if (asset.currentStatus != RWACommonTypes.AssetStatus.ACTIVE) {
            return false;
        }
        
        // Calculate days since last payment
        uint256 daysSincePayment = (block.timestamp - asset.nextPaymentDueDate) / 1 days;
        asset.daysInDefault = daysSincePayment;
        
        // TRIGGER: If past threshold days without payment
        if (daysSincePayment > defaultThresholdDays) {
            asset.missedPayments++;
            
            // On second month of default → officially DEFAULT
            if (asset.missedPayments >= 2) {
                asset.currentStatus = RWACommonTypes.AssetStatus.DEFAULTED;
                
                emit DefaultTriggered(
                    _assetId,
                    asset.missedPayments,
                    daysSincePayment,
                    block.timestamp
                );
                
                return true;
            }
        }
        
        // If past liquidation threshold → LIQUIDATING (Track 2 enforcement)
        if (daysSincePayment > liquidationThresholdDays) {
            asset.currentStatus = RWACommonTypes.AssetStatus.LIQUIDATING;
            
            emit LiquidationInitiated(_assetId, daysSincePayment, block.timestamp);
            
            return true;
        }
        
        return false;
    }

    /**
    * @dev Mark asset as liquidated (after Track 2 enforcement completes).
    * @param _assetId Asset ID
    */
    function completeLiquidation(uint256 _assetId) external onlyRole(EMERGENCY_ADMIN_ROLE) {
        RealWorldAsset storage asset = assets[_assetId];
        require(asset.assetId != 0, "Asset does not exist");
        require(asset.currentStatus == RWACommonTypes.AssetStatus.LIQUIDATING, "Not in liquidation");
        
        asset.currentStatus = RWACommonTypes.AssetStatus.LIQUIDATED;
        
        emit LiquidationCompleted(_assetId, block.timestamp);
    }

    /**
    * @dev Record yield distribution to token holders.
    * Called by Track 2: distribute contract.
    * @param _assetId Asset ID
    * @param _yield Amount to holders
    */
    function recordYieldDistribution(
        uint256 _assetId,
        uint256 _yield
    ) external 
        onlyRole(ASSET_MANAGER_ROLE)
        nonReentrant 
    {
        RealWorldAsset storage asset = assets[_assetId];
        require(asset.assetId != 0, "Asset does not exist");

        require(_yield <= asset.accumulatedYield, "Insufficient accumulated yield");

        // Update tracking
        asset.accumulatedYield -= _yield;
        asset.lastYieldDistributionDate = block.timestamp;
        asset.totalYieldDistributed += _yield;
        
        emit YieldDistributed(
            _assetId,
            _yield,
            block.timestamp
        );
    }

    /**
    * @dev Update asset valuation from trusted oracle.
    * @param _assetId Asset ID
    * @param _newValuation New valuation amount
    */
    function updateValuation(
        uint256 _assetId,
        uint256 _newValuation
    ) external 
        onlyRole(ORACLE_ROLE)
        nonReentrant 
    {
        RealWorldAsset storage asset = assets[_assetId];
        require(asset.assetId != 0, "Asset does not exist");
        require(_newValuation > 0, "Valuation must be positive");
        
        // Rate limit: max 10% change per update (anti-manipulation)
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

    /**
    * @dev Get full asset record. Called by AI Agent.
    */
    function getAsset(uint256 _assetId) external view returns (RealWorldAsset memory) {
        require(assets[_assetId].assetId != 0, "Asset does not exist");
        return assets[_assetId];
    }

    /**
    * @dev Get payment history (simplified: last payment date only).
    */
    function getPaymentHistory(uint256 _assetId) 
        external 
        view 
        returns (
            uint256 lastPaymentDate,
            uint256 accumulatedYield,
            uint256 missedPayments,
            uint256 daysInDefault
        ) 
    {
        RealWorldAsset storage asset = assets[_assetId];
        return (
            asset.lastPaymentDate,
            asset.accumulatedYield,
            asset.missedPayments,
            asset.daysInDefault
        );
    }

    /**
    * @dev Check if asset is in default state.
    */
    function isAssetInDefault(uint256 _assetId) external view returns (bool) {
        return assets[_assetId].currentStatus == RWACommonTypes.AssetStatus.DEFAULTED ||
            assets[_assetId].currentStatus == RWACommonTypes.AssetStatus.LIQUIDATING;
    }

    /**
    * @dev Verify KYC for address (external KYC provider integration).
    */
    function verifyKYC(address _address) external onlyRole(COMPLIANCE_ROLE) {
        require(_address != address(0), "Invalid address");
        kycVerified[_address] = true;
        emit KYCVerified(_address);
    }

    /**
    * @dev Whitelist asset for tokenization.
    */
    function whitelistAsset(uint256 _assetId) external onlyRole(COMPLIANCE_ROLE) {
        RealWorldAsset storage asset = assets[_assetId];
        require(asset.assetId != 0, "Asset does not exist");
        asset.isWhitelisted = true;
        emit AssetWhitelisted(_assetId);
    }

    /**
    * @dev Add trusted oracle address.
    */
    function addTrustedOracle(address _oracle) external onlyRole(EMERGENCY_ADMIN_ROLE) {
        require(_oracle != address(0), "Invalid oracle");
        trustedOracles[_oracle] = true;
        emit OracleAdded(_oracle);
    }


 }