// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20
 * @dev Fully functional ERC20 for testing.
 * Includes mint and burn helpers.
 *
 * DO NOT use in production.
 */
contract MockERC20 is ERC20 {

    constructor(string memory name, string memory symbol)
        ERC20(name, symbol)
    {}

    /**
     * @dev Mint tokens to any address (test-only).
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /**
     * @dev Burn tokens from caller.
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /**
     * @dev Burn tokens from another address using allowance.
     */
    function burnFrom(address from, uint256 amount) external {
        uint256 currentAllowance = allowance(from, msg.sender);
        require(currentAllowance >= amount, "ERC20: burn amount exceeds allowance");

        unchecked {
            _approve(from, msg.sender, currentAllowance - amount);
        }

        _burn(from, amount);
    }
}
