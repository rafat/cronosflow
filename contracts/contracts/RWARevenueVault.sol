// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./InvestorShareToken.sol";
import "./interface/ICashFlowLogic.sol";

/**
 * @dev Central treasury for asset. Holds USDC, tracks distributions.
 * Two buckets:
 * 1. Idle: Available for strategies (rebalancing, investing)
 * 2. Distributable: Ready for investor claims
 */

contract RWARevenueVault is AccessControl, ReentrancyGuard {
    
    bytes32 public constant PAYMENT_ROLE = keccak256("PAYMENT_PROCESSOR");
    bytes32 public constant STRATEGY_ROLE = keccak256("STRATEGY_MANAGER");
    
    IERC20 public paymentToken;       // USDC or other stablecoin
    ICashFlowLogic public logicContract;
    InvestorShareToken public token;  
    IRWAAssetRegistry public registry;

    uint256 public assetId;
    bool private initialized;

    bool public distributionStarted;

    
    // === BALANCE TRACKING ===
    uint256 public totalIdle;         // Available for reinvestment
    uint256 public totalDistributable;// Available for investor claims
    
    // Cumulative reward tracking (for pro-rata calculations)
    uint256 public cumulativeRewardPerToken = 0;
    mapping(address => uint256) public lastClaimedAt;
    mapping(address => uint256) public withdrawn;
    mapping(address => uint256) public rewardDebt;

    
    // === FEE TRACKING ===
    uint256 public protocolFeeBps = 250;  // 2.5% fee
    uint256 public accumulatedFees = 0;
    address public feeRecipient;
    
    event RevenueReceived(uint256 amount, uint256 timestamp);
    event DistributionCommitted(uint256 totalAmount);
    event YieldClaimed(address indexed investor, uint256 amount, uint256 timestamp);
    event CapitalDeployed(uint256 amount, string strategyId);
    event FeeCollected(uint256 amount);
    
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }
    
    /**
     * @dev Initialize vault (called by factory after cloning)
     */
    function initialize(
        address _owner,
        address _logic,
        address _paymentToken,
        address _registry,
        uint256 _assetId
    ) external {
        require(!initialized, "Already initialized");
        initialized = true;
        logicContract = ICashFlowLogic(_logic);
        registry = IRWAAssetRegistry(_registry);
        assetId = _assetId;
        feeRecipient = _owner;
        paymentToken = IERC20(_paymentToken);
        _grantRole(DEFAULT_ADMIN_ROLE, _owner);
        _grantRole(PAYMENT_ROLE, _owner);
        _grantRole(STRATEGY_ROLE, _owner);
    }
    
    /**
     * @dev Set associated token contract (called by factory)
     */
    function setTokenContracts(address _token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        token = InvestorShareToken(_token);
    }

    /**
     * @dev Helper for tests / admin flows: mint shares through vault so
     * that `msg.sender` within `InvestorShareToken.mint` is the vault address
     * (which holds the MINTER_ROLE).
     */
    function mintShares(address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        token.mint(to, amount);
    }
    
    // === PAYMENT INFLOW ===
    
    /**
     * @dev Receive payment from tenant/debtor
     * Assumes tokens have been transferred separately (approve first)
     * @param amount USDC received
     */
    function depositRevenue(uint256 amount) 
        external 
        onlyRole(PAYMENT_ROLE)
        nonReentrant
    {
        require(amount > 0, "Amount must be positive");
        require(
            paymentToken.transferFrom(msg.sender, address(this), amount),
            "Transfer failed"
        );
        
        totalIdle += amount;
        
        emit RevenueReceived(amount, block.timestamp);
    }
    
    // === DISTRIBUTION LOGIC ===
    
    /**
     * @dev Commit idle funds to distribution
     * Called by X402Adapter after aggregation
     * Waterfall:
     * 1. Deduct protocol fees
     * 2. Allocate expected amount to DROP (senior)
     * 3. Rest goes to TIN (junior)
     */
    function commitToDistribution(uint256 monthlyExpectedPayment) 
        external 
        onlyRole(PAYMENT_ROLE)
        nonReentrant
    {
        require(totalIdle >= monthlyExpectedPayment, "Insufficient idle funds");
        require(registry.isAssetActive(assetId), "Asset not active");

        // 1. Deduct fees
        uint256 fees = (monthlyExpectedPayment * protocolFeeBps) / 10000;
        accumulatedFees += fees;
        uint256 netRevenue = monthlyExpectedPayment - fees;
        
        // 2. Move from Idle to Distributable
        totalIdle -= monthlyExpectedPayment;
        totalDistributable += netRevenue;
        
        // 3. Update cumulative reward index (for pro-rata claim calculations)
        uint256 tokenSupply = token.totalSupply();
        
        if (tokenSupply > 0) {
            // All investors get pro-rata share
            if (!distributionStarted) {
                distributionStarted = true;
            }

            cumulativeRewardPerToken += (netRevenue * 1e18) / tokenSupply;
            
            emit DistributionCommitted(netRevenue);
        }
    }
    
    /**
    * @dev Investor claims their pro-rata yield using reward-debt accounting.
    * Prevents double-claims and over-claims when balances change.
    */
    function claimYield()
        external
        nonReentrant
    {
        address investor = msg.sender;
        require(registry.isAssetActive(assetId), "Asset not active");
        uint256 tokenBalance = token.balanceOf(investor);
        require(tokenBalance > 0, "No shares owned");

        // Total rewards investor is entitled to according to the global index
        uint256 accumulatedReward =
            (tokenBalance * cumulativeRewardPerToken) / 1e18;

        // What they can claim now = entitlement - already accounted rewards
        uint256 pendingReward =
            accumulatedReward - rewardDebt[investor];

        require(pendingReward > 0, "No pending rewards");
        require(pendingReward <= totalDistributable, "Insufficient distributable");

        // Update accounting BEFORE external transfer
        rewardDebt[investor] = accumulatedReward;
        totalDistributable -= pendingReward;

        // Optional analytics (not required for correctness)
        withdrawn[investor] += pendingReward;
        lastClaimedAt[investor] = block.timestamp;

        require(
            paymentToken.transfer(investor, pendingReward),
            "Transfer failed"
        );

        emit YieldClaimed(investor, pendingReward, block.timestamp);
    }

    // === CAPITAL REBALANCING (Track 2 + Track 3) ===
    
    /**
     * @dev Deploy idle capital to strategies (e.g., lending, yield farming)
     * For MVP: Just track the deployment. Actual external calls can be added.
     */
    function deployCapital(string calldata strategyId, uint256 amount) 
        external 
        onlyRole(STRATEGY_ROLE)
        nonReentrant
    {
        require(amount <= totalIdle, "Insufficient idle funds");
        require(registry.isAssetActive(assetId), "Asset not active");
        totalIdle -= amount;
        
        // TODO: Route to actual strategy (Compound, Aave, etc)
        // For now, just track it
        
        emit CapitalDeployed(amount, strategyId);
    }
    
    /**
     * @dev Collect accumulated protocol fees
     */
    function withdrawFees() external nonReentrant {
        uint256 feesToWithdraw = accumulatedFees;
        require(feesToWithdraw > 0, "No fees");
        
        accumulatedFees = 0;
        require(paymentToken.transfer(feeRecipient, feesToWithdraw), "Transfer failed");
        
        emit FeeCollected(feesToWithdraw);
    }
    
    // === GETTERS ===
    
    function getBalance() external view returns (uint256) {
        return paymentToken.balanceOf(address(this));
    }
    
    function getAvailableForInvestors() external view returns (uint256) {
        return totalDistributable;
    }
    
    function getAvailableForDeployment() external view returns (uint256) {
        return totalIdle;
    }
}