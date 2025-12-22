// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockRegistry {
    bool public active = true;
    bool public paused = false;
    bool public whitelisted = true;

    function isWhitelisted(address) external pure returns (bool) {
        return true;
    }

    function isAssetPaused(uint256) external view returns (bool) {
        return paused;
    }

    function isAssetActive(uint256) external view returns (bool) {
        return active;
    }

    function setActive(bool v) external {
        active = v;
    }

    function setPaused(bool v) external {
        paused = v;
    }

    function setWhitelisted(bool w) external { 
        whitelisted = w;
    }
}
