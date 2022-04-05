// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "./Vesting.sol";

contract LiquidityRewardsVesting is Vesting {
    constructor(address _owner) {
        owner = _owner;
    }

    function vestingStart() public pure override returns (uint64) {
        // Jun 01 2022 00:00:00 UTC+0
        return 1654041600;
    }

    function vestingFinish() public pure override returns (uint64) {
        // Sep 01 2024 00:00:00 UTC+0
        return 1725148800;
    }

    function tokensTotal() public pure override returns (uint96) {
        return 90_000_000 * 1e18;
    }

    function initialize(address _token) external override onlyAdmin {
        require(!initialized, "Already initialized");
        initialized = true;
        tokensLocked = tokensTotal();
        tokensPerSec = tokensLocked / (vestingFinish() - vestingStart());
        token = IERC20(_token);
        require(token.balanceOf(address(this)) >= tokensLocked, "Token balance lower than desired");
    }
}
