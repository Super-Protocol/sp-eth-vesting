// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "./openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Vesting {
    struct VestingInfo {
        // amount of locked tokens
        uint256 tokensLocked;
        // sum of claimed tokens
        uint256 tokensClaimed;
        // amount of tokens unlocked per second
        uint256 tokensPerSec;
        // vesting start time (differ when the address is p2p buyer)
        uint256 startTime;
        uint256 pausedTime;
    }
    // list of beneficiaries
    mapping(address => VestingInfo) private whitelist;
    // amount of tokens allocated for whitelist
    uint256 public whitelistTokensLimit;
    // amount of tokens allocated for reserve whitelist
    uint256 public whitelistReserveTokensLimit;
    uint256 public whitelistReserveTokensUsed;
    // date of start after lock-up period
    uint64 public startTime;
    // date of vesting finish
    uint64 public finishTime;
    // 3 months lock-up time
    uint64 public constant LOCKUP_TIME = 7948800;
    // 33 months vesting duration
    uint64 public constant DURATION = 36460800;
    IERC20 public token;
    address public immutable owner;

    constructor(address _owner) {
        owner = _owner;
    }

    modifier afterInitialize() {
        require(startTime > 0, "Vesting has not started yet");
        _;
    }

    function initialize(
        address tokenAddress,
        address[] memory accounts,
        uint256[] memory tokenAmounts,
        uint8 reservePercent
    ) external {
        require(msg.sender == owner, "Not allowed to initialize");
        require(startTime == 0, "Already initialized");
        token = IERC20(tokenAddress);
        startTime = uint64(block.timestamp) + LOCKUP_TIME;
        finishTime = startTime + DURATION;

        require(accounts.length == tokenAmounts.length, "Users and tokenAmounts length mismatch");
        require(accounts.length > 0, "No users");
        uint256 vestingBalance = token.balanceOf(address(this));
        require(vestingBalance > 0, "Zero token balance");
        whitelistTokensLimit = (vestingBalance * reservePercent) / 100;
        whitelistReserveTokensLimit = vestingBalance - whitelistTokensLimit;
        uint256 whitelistTokensSum;

        for (uint256 i = 0; i < accounts.length; i++) {
            address account = accounts[i];
            uint256 tokenAmount = tokenAmounts[i];
            require(account != address(0), "Address is zero");
            whitelistTokensSum += tokenAmount;
            require(whitelistTokensSum <= whitelistTokensLimit, "Exceeded tokens limit");
            whitelist[account] = VestingInfo(tokenAmount, 0, tokenAmount / DURATION, startTime, 0);
        }
    }

    function addBeneficiary(address beneficiary, uint256 tokenAmount) external afterInitialize {
        require(msg.sender == owner, "Not allowed to add beneficiary");
        require(beneficiary != address(0), "Address is zero");
        require(whitelist[beneficiary].startTime == 0, "Beneficiary is already in whitelist");
        whitelistReserveTokensUsed += tokenAmount;
        require(whitelistReserveTokensUsed <= whitelistReserveTokensLimit, "Exceeded tokens limit");
        whitelist[beneficiary] = VestingInfo(tokenAmount, 0, tokenAmount / DURATION, startTime, 0);
    }

    function getBeneficiaryInfo(address beneficiary) public view returns (VestingInfo memory) {
        if (whitelist[beneficiary].startTime > 0) {
            return whitelist[beneficiary];
        } else {
            revert("Account is not in whitelist");
        }
    }

    function calculateClaim(address beneficiary) external view afterInitialize returns (uint256) {
        VestingInfo memory vesting = getBeneficiaryInfo(beneficiary);

        return _calculateClaim(vesting);
    }

    function _calculateClaim(VestingInfo memory vesting) private view returns (uint256) {
        require(block.timestamp > vesting.startTime, "Cannot claim during 3 months lock-up period");
        if (vesting.pausedTime > 0) {
            return (vesting.pausedTime - vesting.startTime) * vesting.tokensPerSec - vesting.tokensClaimed;
        }

        if (block.timestamp < finishTime) {
            return (block.timestamp - vesting.startTime) * vesting.tokensPerSec - vesting.tokensClaimed;
        } else {
            return vesting.tokensLocked;
        }
    }

    function claim(address to, uint256 amount) external {
        address sender = msg.sender;
        VestingInfo memory vesting = getBeneficiaryInfo(sender);
        uint256 unlocked = _calculateClaim(vesting);
        require(unlocked >= amount, "Requested more than unlocked");

        whitelist[sender].tokensLocked -= amount;
        whitelist[sender].tokensClaimed += amount;

        token.transfer(to, amount);
    }

    function sellShare(address to, uint256 amount) external afterInitialize {
        address sender = msg.sender;
        require(sender != to, "Cannot sell to the same address");
        VestingInfo memory vesting = getBeneficiaryInfo(sender);

        uint256 unlocked = _calculateClaim(vesting);

        require(vesting.tokensLocked - unlocked >= amount, "Requested more tokens than available");

        whitelist[sender].tokensLocked -= amount;

        whitelist[to] = VestingInfo(amount, 0, amount / (finishTime - block.timestamp), block.timestamp, 0);
    }

    function setPaused(bool paused) external afterInitialize {
        require(whitelist[msg.sender].startTime > 0, "Account is not in whitelist");
        if (paused) {
            whitelist[msg.sender].pausedTime = block.timestamp;
        } else {
            whitelist[msg.sender].pausedTime = 0;
        }
    }
}
