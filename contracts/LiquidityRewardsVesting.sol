// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "./Vesting.sol";

contract LiquidityRewardsVesting is Vesting {
    constructor(address _owner) {
        owner = _owner;
    }

    function tokensTotal() public pure override returns (uint96) {
        return 90_000_000 * 1e18;
    }

    function vestingDuration() public pure override returns (uint64) {
        return 71107200; // 2 years 3 months
    }
}
