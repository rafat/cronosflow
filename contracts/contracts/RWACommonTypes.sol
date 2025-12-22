// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

library RWACommonTypes {
    enum AssetType { REAL_ESTATE, INVOICE, BOND, COMMODITY }

    enum AssetStatus { 
        REGISTERED,
        LINKED,
        ACTIVE,
        UNDER_REVIEW,
        DEFAULTED,
        LIQUIDATING,
        LIQUIDATED,
        PAUSED,
        EXPIRED
    }
}
