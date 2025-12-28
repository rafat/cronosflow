// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./InvestorShareToken.sol";
import "./interface/ICashFlowLogic.sol";

interface IRWAAssetRegistryView {
    function isAssetActive(uint256 assetId) external view returns (bool);
    function isWhitelisted(address recipient) external view returns (bool);
}

contract RWARevenueVault is AccessControl, ReentrancyGuard {
    bytes32 public constant PAYMENT_ROLE = keccak256("PAYMENT_PROCESSOR");
    bytes32 public constant STRATEGY_ROLE = keccak256("STRATEGY_MANAGER");

    IERC20 public paymentToken;
    ICashFlowLogic public logicContract;
    InvestorShareToken public token;
    IRWAAssetRegistryView public registry;

    uint256 public assetId;
    bool private initialized;

    bool public distributionStarted;

    uint256 public totalIdle;
    uint256 public totalDistributable;

    uint256 public cumulativeRewardPerToken = 0;

    // UPDATED accounting:
    mapping(address => uint256) public rewardDebt;       // based on current balance
    mapping(address => uint256) public pendingRewards;   // accrued but not yet claimed

    // analytics
    mapping(address => uint256) public lastClaimedAt;
    mapping(address => uint256) public withdrawn;

    uint256 public protocolFeeBps = 250;
    uint256 public accumulatedFees = 0;
    address public feeRecipient;

    event RevenueReceived(uint256 amount, uint256 timestamp);
    event DistributionCommitted(uint256 totalAmount);
    event YieldClaimed(address indexed investor, uint256 amount, uint256 timestamp);
    event CapitalDeployed(uint256 amount, string strategyId);
    event FeeCollected(uint256 amount);

    constructor() {
        // recommended: no grants here if using initialize; but keeping for non-proxy deployment
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function initialize(
        address _admin,
        address _agent,
        address _logic,
        address _paymentToken,
        address _registry,
        uint256 _assetId,
        address _feeRecipient
    ) external {
        require(!initialized, "Already initialized");
        require(_admin != address(0), "Invalid admin");
        require(_agent != address(0), "Invalid agent");
        require(_logic != address(0), "Invalid logic");
        require(_paymentToken != address(0), "Invalid payment token");
        require(_registry != address(0), "Invalid registry");
        require(_feeRecipient != address(0), "Invalid feeRecipient");

        initialized = true;
        logicContract = ICashFlowLogic(_logic);
        registry = IRWAAssetRegistryView(_registry);
        assetId = _assetId;
        feeRecipient = _feeRecipient;
        paymentToken = IERC20(_paymentToken);

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(PAYMENT_ROLE, _agent);
        _grantRole(STRATEGY_ROLE, _agent);
    }

    function setTokenContracts(address _token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_token != address(0), "Invalid token");
        token = InvestorShareToken(_token);
    }

    function mintShares(address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        token.mint(to, amount);
        // token will call onTokenTransfer(0,to) and accounting will be updated
    }

    function depositRevenue(address _from, uint256 amount)
        external
        onlyRole(PAYMENT_ROLE)
        nonReentrant
    {
        require(amount > 0, "Amount must be positive");
        require(paymentToken.transferFrom(_from, address(this), amount), "Transfer failed");
        totalIdle += amount;
        emit RevenueReceived(amount, block.timestamp);
    }

    function commitToDistribution(uint256 monthlyExpectedPayment)
        external
        onlyRole(PAYMENT_ROLE)
        nonReentrant
    {
        (, uint256 expected,) = logicContract.getSchedule();
        require(totalIdle >= monthlyExpectedPayment, "Insufficient idle funds");
        require(monthlyExpectedPayment == expected, "Expected payment mismatch");
        require(registry.isAssetActive(assetId), "Asset not active");

        uint256 fees = (monthlyExpectedPayment * protocolFeeBps) / 10000;
        accumulatedFees += fees;
        uint256 netRevenue = monthlyExpectedPayment - fees;

        totalIdle -= monthlyExpectedPayment;
        totalDistributable += netRevenue;

        uint256 tokenSupply = token.totalSupply();
        if (tokenSupply > 0) {
            if (!distributionStarted) distributionStarted = true;
            cumulativeRewardPerToken += (netRevenue * 1e18) / tokenSupply;
            emit DistributionCommitted(netRevenue);
        }
    }

    /**
     * NEW: Called by token after any mint/burn/transfer to maintain fair reward accounting.
     * Only the token contract may call this.
     */
    function onTokenTransfer(address from, address to) external nonReentrant {
        require(msg.sender == address(token), "Only token");

        // settle both sides into pendingRewards using their balances BEFORE debt update
        if (from != address(0)) _settleAccount(from);
        if (to != address(0) && to != from) _settleAccount(to);

        // update debt to reflect current balance
        if (from != address(0)) rewardDebt[from] = (token.balanceOf(from) * cumulativeRewardPerToken) / 1e18;
        if (to != address(0)) rewardDebt[to] = (token.balanceOf(to) * cumulativeRewardPerToken) / 1e18;
    }

    function _settleAccount(address account) internal {
        uint256 bal = token.balanceOf(account);
        uint256 accrued = (bal * cumulativeRewardPerToken) / 1e18;
        uint256 debt = rewardDebt[account];

        if (accrued > debt) {
            pendingRewards[account] += (accrued - debt);
        }
    }

    function claimYield() external nonReentrant {
        address investor = msg.sender;
        require(registry.isAssetActive(assetId), "Asset not active");
        require(registry.isWhitelisted(investor), "Not whitelisted");

        // settle latest accrual
        _settleAccount(investor);
        rewardDebt[investor] = (token.balanceOf(investor) * cumulativeRewardPerToken) / 1e18;

        uint256 amount = pendingRewards[investor];
        require(amount > 0, "No pending rewards");
        require(amount <= totalDistributable, "Insufficient distributable");

        pendingRewards[investor] = 0;
        totalDistributable -= amount;

        withdrawn[investor] += amount;
        lastClaimedAt[investor] = block.timestamp;

        require(paymentToken.transfer(investor, amount), "Transfer failed");
        emit YieldClaimed(investor, amount, block.timestamp);
    }

    function deployCapital(string calldata strategyId, uint256 amount)
        external
        onlyRole(STRATEGY_ROLE)
        nonReentrant
    {
        require(amount <= totalIdle, "Insufficient idle funds");
        require(registry.isAssetActive(assetId), "Asset not active");
        totalIdle -= amount;
        emit CapitalDeployed(amount, strategyId);
    }

    function withdrawFees() external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 feesToWithdraw = accumulatedFees;
        require(feesToWithdraw > 0, "No fees");

        accumulatedFees = 0;
        require(paymentToken.transfer(feeRecipient, feesToWithdraw), "Transfer failed");
        emit FeeCollected(feesToWithdraw);
    }

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