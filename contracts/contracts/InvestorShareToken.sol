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
    function isWhitelisted(address user) external view returns (bool);
    function isAssetPaused(uint256 assetId) external view returns (bool);
    function isAssetActive(uint256 assetId) external view returns (bool);
}

contract InvestorShareToken is ERC20, AccessControl {
    // =========================
    // Roles
    // =========================
    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");

    // =========================
    // Immutable Asset Binding
    // =========================
    uint256 public immutable assetId;
    address public immutable registry;
    address public immutable vault;
    uint256 public immutable maxSupply;

    // =========================
    // Events
    // =========================
    event TokenMinted(address indexed to, uint256 amount);
    event TokenBurned(address indexed from, uint256 amount);

    /**
     * @dev Constructor (Option A).
     * Deployed once per asset by AssetFactory.
     *
     * @param _assetId Asset ID in RWAAssetRegistry
     * @param _name ERC20 name (e.g. "RWA Singapore Office #12")
     * @param _symbol ERC20 symbol (e.g. "RWA12")
     * @param _maxSupply Fixed total supply cap
     * @param _registry Address of RWAAssetRegistry
     * @param _vault Address of the asset's RWARevenueVault
     */
    constructor(
        uint256 _assetId,
        string memory _name,
        string memory _symbol,
        uint256 _maxSupply,
        address _registry,
        address _vault
    ) ERC20(_name, _symbol) {
        require(_assetId > 0, "Invalid assetId");
        require(_maxSupply > 0, "Max supply must be > 0");
        require(_registry != address(0), "Invalid registry");
        require(_vault != address(0), "Invalid vault");

        assetId = _assetId;
        registry = _registry;
        vault = _vault;
        maxSupply = _maxSupply;

        // Vault is the sole economic controller
        _grantRole(DEFAULT_ADMIN_ROLE, _vault);
        _grantRole(VAULT_ROLE, _vault);
    }

    // =========================
    // Mint / Burn (Vault only)
    // =========================

    /**
     * @dev Mint new ownership shares during capital raise.
     * Callable only by the asset's vault.
     */
    function mint(address to, uint256 amount)
        external
        onlyRole(VAULT_ROLE)
    {
        require(totalSupply() + amount <= maxSupply, "Max supply exceeded");
        _mint(to, amount);
        emit TokenMinted(to, amount);
    }

    /**
     * @dev Burn shares on redemption / liquidation.
     * Callable only by the asset's vault.
     */
    function burn(address from, uint256 amount)
        external
        onlyRole(VAULT_ROLE)
    {
        _burn(from, amount);
        emit TokenBurned(from, amount);
    }

    // =========================
    // Compliance & Lifecycle Gates
    // =========================

    /**
     * @dev Enforces registry-driven compliance rules.
     *
     * Transfers are allowed only if:
     * - Asset is ACTIVE
     * - Asset is not PAUSED
     * - Recipient is whitelisted
     *
     * Minting and burning bypass these checks.
     */
    function _update(
        address from,
        address to,
        uint256 amount
    ) internal override {
        super._update(from, to, amount);

        // Allow mint & burn
        if (from == address(0) || to == address(0)) {
            return;
        }

        IRWAAssetRegistry reg = IRWAAssetRegistry(registry);

        require(reg.isAssetActive(assetId), "Asset not active");
        require(!reg.isAssetPaused(assetId), "Asset paused");
        require(reg.isWhitelisted(to), "Recipient not whitelisted");
    }

    // =========================
    // Read Helpers
    // =========================

    /**
     * @dev Returns investor ownership in basis points (10000 = 100%).
     */
    function ownershipBps(address investor)
        external
        view
        returns (uint256)
    {
        uint256 supply = totalSupply();
        if (supply == 0) return 0;
        return (balanceOf(investor) * 10_000) / supply;
    }
}
