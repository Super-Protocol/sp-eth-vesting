// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "./openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Vesting {
    struct VestingInfo {
        uint256 tokensLocked;
        uint256 tokensClaimed;
        // staging on sell, claim, pause
        uint stagedProfit;
        // amount of tokens unlocked per second
        uint256 tokensPerSec;
        // date of locked balance change (sell, claim)
        uint lastChange;
        // timestamp since when claim amount is not increasing
        uint256 pausedTime;
    }
    mapping(address => VestingInfo) private whitelist;
    uint256 public whitelistTokensLimit;
    uint256 public whitelistReserveTokensLimit;
    uint256 public whitelistReserveTokensUsed;

    // Sep 01 2022 00:00:00 GMT+0
    uint64 public constant LOCKUP_END = 1661990400;
    // Jun 01 2025 00:00:00 GMT+0
    uint64 public constant FINISH = 1748736000;
    // 33 months vesting duration
    uint64 public constant DURATION = 86745600;

    IERC20 public token;
    address public immutable owner;
    bool initialized;

    constructor(address _owner) {
        owner = _owner;
    }

    modifier afterInitialize() {
        require(initialized, "Vesting has not started yet");
        _;
    }

    function initialize(
        address tokenAddress,
        address[] memory accounts,
        uint256[] memory tokenAmounts,
        uint128 mainAllocation,
        uint128 reserveAllocation
    ) external {
        require(msg.sender == owner, "Not allowed to initialize");
        require(!initialized, "Already initialized");
        initialized = true;
        require(accounts.length == tokenAmounts.length, "Users and tokenAmounts length mismatch");
        require(accounts.length > 0, "No users");
        token = IERC20(tokenAddress);
        require(token.balanceOf(address(this)) >= mainAllocation + reserveAllocation, "Insufficient token balance");

        whitelistTokensLimit = mainAllocation;
        whitelistReserveTokensLimit = reserveAllocation;
        uint256 whitelistTokensSum;

        for (uint256 i = 0; i < accounts.length; i++) {
            address account = accounts[i];
            uint256 tokenAmount = tokenAmounts[i];
            require(account != address(0), "Address is zero");
            whitelistTokensSum += tokenAmount;
            require(whitelistTokensSum <= mainAllocation, "Exceeded tokens limit");
            whitelist[account] = VestingInfo(tokenAmount, 0, 0, tokenAmount / DURATION, LOCKUP_END, 0);
        }
    }

    function addBeneficiary(address beneficiary, uint256 tokenAmount) external afterInitialize {
        require(msg.sender == owner, "Not allowed to add beneficiary");
        require(beneficiary != address(0), "Address is zero");
        require(whitelist[beneficiary].lastChange == 0, "Beneficiary is already in whitelist");
        whitelistReserveTokensUsed += tokenAmount;
        require(whitelistReserveTokensUsed <= whitelistReserveTokensLimit, "Exceeded tokens limit");
        whitelist[beneficiary] = VestingInfo(tokenAmount, 0, 0, tokenAmount / DURATION, LOCKUP_END, 0);
    }

    function getBeneficiaryInfo(address beneficiary) public view returns (VestingInfo memory) {
        if (whitelist[beneficiary].lastChange > 0) {
            return whitelist[beneficiary];
        } else {
            revert("Account is not in whitelist");
        }
    }

    function calculateClaim(address beneficiary) external view returns (uint256) {
        VestingInfo memory vesting = getBeneficiaryInfo(beneficiary);

        return _calculateClaim(vesting) + vesting.stagedProfit;
    }

    function _calculateClaim(VestingInfo memory vesting) private view returns (uint256) {
        if (vesting.pausedTime > 0 || block.timestamp < vesting.lastChange) {
            return 0;
        }
        if (block.timestamp < FINISH) {
            return (block.timestamp - vesting.lastChange) * vesting.tokensPerSec;
        }
        return vesting.tokensLocked;
    }

    function claim(address to, uint256 amount) external {
        address sender = msg.sender;
        VestingInfo memory vesting = getBeneficiaryInfo(sender);
        require(block.timestamp > vesting.lastChange, "Cannot claim during 3 months lock-up period");
        uint256 unlocked = _calculateClaim(vesting);
        require(unlocked + vesting.stagedProfit >= amount, "Requested more than unlocked");

        if (vesting.stagedProfit >= amount) {
            whitelist[sender].stagedProfit -= amount;
        } else {
            whitelist[sender].tokensLocked += vesting.stagedProfit;
            whitelist[sender].tokensLocked -= amount;
            whitelist[sender].tokensClaimed += amount;
            whitelist[sender].lastChange = block.timestamp;
        }
        token.transfer(to, amount);
    }

    function sellShare(address to, uint256 amount) external afterInitialize {
        address sender = msg.sender;
        require(sender != to, "Cannot sell to the same address");
        VestingInfo memory vesting = getBeneficiaryInfo(sender);
        uint256 unlocked = _calculateClaim(vesting);
        uint timestamp = block.timestamp;

        require(vesting.tokensLocked - unlocked >= amount, "Requested more tokens than locked");

        whitelist[sender].tokensLocked -= amount;
        if (timestamp > LOCKUP_END) {
            whitelist[to] = VestingInfo(amount, 0, 0, amount / (FINISH - timestamp), timestamp, 0);
            whitelist[sender].stagedProfit += unlocked;
            whitelist[sender].tokensLocked -= unlocked;
            whitelist[sender].lastChange = timestamp;
            whitelist[sender].tokensPerSec = whitelist[sender].tokensLocked / (FINISH - timestamp);
        } else {
            whitelist[to] = VestingInfo(amount, 0, 0, amount / DURATION, LOCKUP_END, 0);
            whitelist[sender].tokensPerSec = whitelist[sender].tokensLocked / DURATION;
        }
    }

    function setPaused(bool paused) external {
        VestingInfo storage vesting = whitelist[msg.sender];
        require(vesting.lastChange > 0, "Account is not in whitelist");
        require(block.timestamp > vesting.lastChange, "Cannot pause during 3 months lock-up period");
        if (paused) {
            uint unlocked = _calculateClaim(vesting);
            vesting.stagedProfit += unlocked;
            vesting.tokensLocked -= unlocked;
            vesting.lastChange = block.timestamp;
            vesting.pausedTime = block.timestamp;
        } else {
            vesting.pausedTime = 0;
        }
    }
}
