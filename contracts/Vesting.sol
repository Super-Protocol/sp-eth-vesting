// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "./openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Vesting {
    struct VestingInfo {
        uint96 tokensLocked;
        uint96 tokensClaimed;
        // timestamp since when claim amount is not increasing
        uint64 pausedTime;
        // staging on sell, claim, pause
        uint96 stagedProfit;
        // amount of tokens unlocked per second
        uint96 tokensPerSec;
        // date of locked balance change (sell, claim)
        uint64 lastChange;
    }
    mapping(address => VestingInfo) private whitelist;
    uint96 public whitelistReserveTokensLimit;
    uint96 public whitelistReserveTokensUsed;
    address public immutable owner;
    bool initialized;

    // Sep 01 2022 00:00:00 UTC+0
    uint64 public constant VESTING_LOCKUP_END = 1661990400;
    // Jun 01 2025 00:00:00 UTC+0
    uint64 public constant VESTING_FINISH = 1748736000;
    // 33 months vesting duration
    uint64 public constant VESTING_DURATION = 86745600;

    IERC20 public token;

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
        uint96[] memory tokenAmounts,
        uint96 mainAllocation,
        uint96 reserveAllocation
    ) external {
        require(msg.sender == owner, "Not allowed to initialize");
        require(!initialized, "Already initialized");
        initialized = true;
        require(accounts.length == tokenAmounts.length, "Users and tokenAmounts length mismatch");
        require(accounts.length > 0, "No users");
        token = IERC20(tokenAddress);
        require(token.balanceOf(address(this)) >= mainAllocation + reserveAllocation, "Insufficient token balance");

        whitelistReserveTokensLimit = reserveAllocation;
        uint96 whitelistTokensSum;

        for (uint96 i = 0; i < accounts.length; i++) {
            address account = accounts[i];
            uint96 tokenAmount = tokenAmounts[i];
            require(account != address(0), "Address is zero");
            whitelistTokensSum += tokenAmount;
            require(whitelistTokensSum <= mainAllocation, "Exceeded tokens limit");
            whitelist[account] = VestingInfo(tokenAmount, 0, 0, 0, tokenAmount / VESTING_DURATION, VESTING_LOCKUP_END);
        }
    }

    function addBeneficiary(address beneficiary, uint96 tokenAmount) external afterInitialize {
        require(msg.sender == owner, "Not allowed to add beneficiary");
        require(beneficiary != address(0), "Address is zero");
        require(whitelist[beneficiary].lastChange == 0, "Beneficiary is already in whitelist");
        whitelistReserveTokensUsed += tokenAmount;
        require(whitelistReserveTokensUsed <= whitelistReserveTokensLimit, "Exceeded tokens limit");
        whitelist[beneficiary] = VestingInfo(tokenAmount, 0, 0, 0, tokenAmount / VESTING_DURATION, VESTING_LOCKUP_END);
    }

    function getBeneficiaryInfo(address beneficiary) public view returns (VestingInfo memory) {
        if (whitelist[beneficiary].lastChange > 0) {
            return whitelist[beneficiary];
        } else {
            revert("Account is not in whitelist");
        }
    }

    function calculateClaim(address beneficiary) external view returns (uint96) {
        VestingInfo memory vesting = getBeneficiaryInfo(beneficiary);

        return _calculateClaim(vesting) + vesting.stagedProfit;
    }

    function _calculateClaim(VestingInfo memory vesting) private view returns (uint96) {
        if (vesting.pausedTime > 0 || block.timestamp < vesting.lastChange) {
            return 0;
        }
        if (block.timestamp < VESTING_FINISH) {
            return (uint64(block.timestamp) - vesting.lastChange) * vesting.tokensPerSec;
        }
        return vesting.tokensLocked;
    }

    function claim(address to, uint96 amount) external {
        require(block.timestamp > VESTING_LOCKUP_END, "Cannot claim during 3 months lock-up period");
        address sender = msg.sender;
        require(whitelist[sender].lastChange > 0, "Claimer is not in whitelist");
        VestingInfo memory vesting = calculateProfitAndStage(sender);
        require(vesting.stagedProfit >= amount, "Requested more than unlocked");

        whitelist[sender].stagedProfit -= amount;
        whitelist[sender].tokensClaimed += amount;
        token.transfer(to, amount);
    }

    function sellShare(address to, uint96 amount) external afterInitialize {
        address sender = msg.sender;
        require(sender != to, "Cannot sell to the same address");
        require(whitelist[sender].lastChange > 0, "Sender is not in whitelist");

        uint64 timestamp = uint64(block.timestamp);
        VestingInfo storage buyer = whitelist[to];
        if (timestamp > VESTING_LOCKUP_END) {
            VestingInfo memory seller = calculateProfitAndStage(sender);
            require(seller.tokensLocked >= amount, "Requested more tokens than locked");

            whitelist[sender].tokensLocked -= amount;
            whitelist[sender].tokensPerSec = whitelist[sender].tokensLocked / (VESTING_FINISH - timestamp);

            if (buyer.lastChange == 0) {
                whitelist[to] = VestingInfo(amount, 0, 0, 0, amount / (VESTING_FINISH - timestamp), timestamp);
            } else {
                buyer.tokensLocked += amount;
                if (buyer.pausedTime == 0) {
                    calculateProfitAndStage(to);
                    buyer.tokensPerSec = buyer.tokensLocked / (VESTING_FINISH - timestamp);
                }
            }
        } else {
            if (buyer.lastChange == 0) {
                whitelist[to] = VestingInfo(amount, 0, 0, 0, amount / VESTING_DURATION, VESTING_LOCKUP_END);
            } else {
                buyer.tokensLocked += amount;
                buyer.tokensPerSec = buyer.tokensLocked / VESTING_DURATION;
            }
            whitelist[sender].tokensLocked -= amount;
            whitelist[sender].tokensPerSec = whitelist[sender].tokensLocked / VESTING_DURATION;
        }
    }

    function setPaused(bool paused) external {
        VestingInfo storage vesting = whitelist[msg.sender];
        require(vesting.lastChange > 0, "Account is not in whitelist");
        uint64 timestamp = uint64(block.timestamp);
        require(timestamp > VESTING_LOCKUP_END, "Cannot pause during 3 months lock-up period");
        if (paused) {
            require(vesting.pausedTime == 0, "Already on pause");
            calculateProfitAndStage(msg.sender);
            vesting.pausedTime = timestamp;
            vesting.tokensPerSec = 0;
        } else {
            require(vesting.pausedTime > 0, "Already unpaused");
            vesting.pausedTime = 0;
            vesting.lastChange = timestamp;
            vesting.tokensPerSec = timestamp < VESTING_FINISH ? vesting.tokensLocked / (VESTING_FINISH - timestamp) : 0;
        }
    }

    // pass only existing beneficiary
    function calculateProfitAndStage(address beneficiary) private returns (VestingInfo memory) {
        VestingInfo storage vesting = whitelist[beneficiary];
        uint96 unlocked = _calculateClaim(vesting);
        vesting.stagedProfit += unlocked;
        vesting.tokensLocked -= unlocked;
        vesting.lastChange = uint64(block.timestamp);
        return vesting;
    }
}
