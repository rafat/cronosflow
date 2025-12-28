// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title InvestorShareToken
 * @dev ERC-20 representing fractional ownership of a single RWA's cashflows.
 * One token contract MUST correspond to exactly one assetId in RWAAssetRegistry.
 */
interface IRWAAssetRegistry {
    function isWhitelisted(address recipient) external view returns (bool);
    function isAssetPaused(uint256 assetId) external view returns (bool);
    function isAssetActive(uint256 assetId) external view returns (bool);
}

interface IRWARevenueVault {
    function distributionStarted() external view returns (bool);

    // NEW: used for transfer-safe yield accounting
    function onTokenTransfer(address from, address to) external;
}

contract InvestorShareToken is ERC20, AccessControl {
    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");

    uint256 public immutable assetId;
    address public immutable registry;
    address public immutable vault;
    uint256 public immutable maxSupply;

    event TokenMinted(address indexed to, uint256 amount);
    event TokenBurned(address indexed from, uint256 amount);

    constructor(
        uint256 _assetId,
        string memory _name,
        string memory _symbol,
        uint256 _maxSupply,
        address _registry,
        address _vault,
        address _admin
    ) ERC20(_name, _symbol) {
        require(_assetId > 0, "Invalid assetId");
        require(_maxSupply > 0, "Max supply must be > 0");
        require(_registry != address(0), "Invalid registry");
        require(_admin != address(0), "Invalid admin");
        require(_vault != address(0), "Invalid vault");

        assetId = _assetId;
        registry = _registry;
        vault = _vault;
        maxSupply = _maxSupply;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(VAULT_ROLE, _vault);
    }

    modifier supplyUnlocked() {
        require(!IRWARevenueVault(vault).distributionStarted(), "Supply locked");
        _;
    }

    function mint(address to, uint256 amount)
        external
        onlyRole(VAULT_ROLE)
        supplyUnlocked
    {
        require(IRWAAssetRegistry(registry).isWhitelisted(to), "Recipient not whitelisted");
        require(totalSupply() + amount <= maxSupply, "Max supply exceeded");
        _mint(to, amount);
        emit TokenMinted(to, amount);
    }

    function burn(address from, uint256 amount)
        external
        onlyRole(VAULT_ROLE)
        supplyUnlocked
    {
        _burn(from, amount);
        emit TokenBurned(from, amount);
    }

    /**
     * Transfers are allowed only if:
     * - Asset is ACTIVE
     * - Asset is not PAUSED
     * - Sender and recipient are whitelisted
     *
     * NOTE: Transfers are NOT locked after distributions anymore.
     * Supply (mint/burn) is still locked by supplyUnlocked().
     */
    function _update(address from, address to, uint256 amount) internal override {
        // Only gate transfers (not mint/burn)
        if (from != address(0) && to != address(0)) {
            IRWAAssetRegistry reg = IRWAAssetRegistry(registry);
            require(reg.isAssetActive(assetId), "Asset not active");
            require(!reg.isAssetPaused(assetId), "Asset paused");
            require(reg.isWhitelisted(from), "Sender not whitelisted");
            require(reg.isWhitelisted(to), "Recipient not whitelisted");
        }

        super._update(from, to, amount);

        // NEW: notify vault so yield accounting remains correct with transfers
        // Call after balances change
        if (from != to) {
            IRWARevenueVault(vault).onTokenTransfer(from, to);
        }
    }

    function ownershipBps(address investor) external view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 0;
        return (balanceOf(investor) * 10_000) / supply;
    }
}