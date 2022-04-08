// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "./openzeppelin/contracts/token/ERC20/IERC20.sol";

contract InsidersVesting {
    struct BeneficiaryInfo {
        uint64 startTime;
        uint96 tokensLocked;
        uint96 tokensUnlocked;
        uint96 tokensClaimed;
        uint96 tokensLockedTransferred;
        uint96 tokensUnlockedTransferred;
        uint96 tokensPerSec;
        uint64 lastVestingUpdate;
    }
    mapping(address => BeneficiaryInfo) private whitelist;
    address public immutable owner;
    bool public initialized;
    uint64 public vestingStart;
    uint64 public lockupEnd;
    uint64 public vestingFinish;

    uint64 public constant VESTING_LOCKUP_DURATION = 90 * 1 days;
    uint64 public constant VESTING_DURATION = 86745600; // 33 months
    uint96 public constant TOKENS_TOTAL = 400_000_000 * 1e18;

    IERC20 public token;

    event TokensClaimed(address indexed to, uint256 amount);

    constructor(address _owner) {
        owner = _owner;
    }

    modifier afterInitialize() {
        require(initialized, "Vesting has not started yet");
        _;
    }

    modifier onlyFromWhitelist() {
        require(whitelist[msg.sender].lastVestingUpdate > 0, "You are not in whitelist");
        _;
    }

    function initialize(
        address tokenAddress,
        address[] memory accounts,
        uint96[] memory tokenAmounts,
        uint64 _vestingStart
    ) external {
        require(msg.sender == owner, "Not allowed to initialize");
        require(!initialized, "Already initialized");
        initialized = true;
        require(accounts.length == tokenAmounts.length, "Users and tokenAmounts length mismatch");
        require(accounts.length > 0, "No users");
        token = IERC20(tokenAddress);
        require(token.balanceOf(address(this)) >= TOKENS_TOTAL, "Insufficient token balance");
        vestingStart = _vestingStart;
        lockupEnd = _vestingStart + VESTING_LOCKUP_DURATION;
        vestingFinish = _vestingStart + VESTING_LOCKUP_DURATION + VESTING_DURATION;
        uint96 whitelistTokensSum;

        for (uint96 i = 0; i < accounts.length; i++) {
            address account = accounts[i];
            uint96 tokenAmount = tokenAmounts[i];
            require(account != address(0), "Address is zero");
            whitelistTokensSum += tokenAmount;
            require(whitelistTokensSum <= TOKENS_TOTAL, "Exceeded tokens limit");
            whitelist[account] = BeneficiaryInfo(_vestingStart, tokenAmount, 0, 0, 0, 0, tokenAmount / VESTING_DURATION, lockupEnd);
        }
    }

    function getBeneficiaryInfo(address beneficiary) public view returns (BeneficiaryInfo memory) {
        if (whitelist[beneficiary].lastVestingUpdate > 0) {
            return whitelist[beneficiary];
        } else {
            revert("Account is not in whitelist");
        }
    }

    function calculateClaim(address beneficiary) external view returns (uint96) {
        BeneficiaryInfo memory vesting = getBeneficiaryInfo(beneficiary);

        return _calculateClaim(vesting) + vesting.tokensUnlocked;
    }

    function _calculateClaim(BeneficiaryInfo memory info) private view returns (uint96) {
        if (block.timestamp < info.lastVestingUpdate) {
            return 0;
        }
        if (block.timestamp < vestingFinish) {
            return (uint64(block.timestamp) - info.lastVestingUpdate) * info.tokensPerSec;
        }
        return info.tokensLocked;
    }

    function claim(address to, uint96 amount) external onlyFromWhitelist {
        require(block.timestamp > lockupEnd, "Cannot claim during 3 months lock-up period");
        address sender = msg.sender;
        BeneficiaryInfo memory vesting = calculateProfitAndStage(sender);
        require(vesting.tokensUnlocked >= amount, "Requested more than unlocked");

        whitelist[sender].tokensUnlocked -= amount;
        whitelist[sender].tokensClaimed += amount;
        token.transfer(to, amount);
        emit TokensClaimed(to, amount);
    }

    function transfer(address to, uint96 lockedTokens, uint96 unlockedTokens) external afterInitialize onlyFromWhitelist {
        address sender = msg.sender;
        require(sender != to, "Cannot sell to the same address");
        BeneficiaryInfo memory from = calculateProfitAndStage(sender);
        require(from.tokensLocked >= lockedTokens, "Requested more tokens than locked");
        require(from.tokensUnlocked >= unlockedTokens, "Requested more tokens than unlocked");
        _transfer(to, lockedTokens, unlockedTokens);
    }

    function transferAll(address to) external afterInitialize onlyFromWhitelist {
        BeneficiaryInfo memory from = calculateProfitAndStage(msg.sender);
        _transfer(to, from.tokensLocked, from.tokensUnlocked);
    }

    function _transfer(address to, uint96 lockedTokens, uint96 unlockedTokens) private {
        address sender = msg.sender;
        require(sender != to, "Cannot sell to the same address");
        uint64 timestamp = uint64(block.timestamp);
        BeneficiaryInfo storage buyer = whitelist[to];

        whitelist[sender].tokensLocked -= lockedTokens;
        whitelist[sender].tokensLockedTransferred += lockedTokens;

        if (timestamp > lockupEnd) {
            whitelist[sender].tokensUnlocked -= unlockedTokens;
            whitelist[sender].tokensUnlockedTransferred += unlockedTokens;
            whitelist[sender].tokensPerSec = whitelist[sender].tokensLocked / (vestingFinish - timestamp);

            if (buyer.lastVestingUpdate == 0) {
                whitelist[to] = BeneficiaryInfo(timestamp, lockedTokens, unlockedTokens, 0, 0, 0, lockedTokens / (vestingFinish - timestamp), timestamp);
            } else {
                calculateProfitAndStage(to);
                buyer.tokensLocked += lockedTokens;
                buyer.tokensUnlocked += unlockedTokens;
                buyer.tokensPerSec = buyer.tokensLocked / (vestingFinish - timestamp);
            }
        } else {
            whitelist[sender].tokensPerSec = whitelist[sender].tokensLocked / VESTING_DURATION;
            if (buyer.lastVestingUpdate == 0) {
                whitelist[to] = BeneficiaryInfo(timestamp, lockedTokens, 0, 0, 0, 0, lockedTokens / VESTING_DURATION, lockupEnd);
            } else {
                buyer.tokensLocked += lockedTokens;
                buyer.tokensPerSec = buyer.tokensLocked / VESTING_DURATION;
            }
        }
    }

    // pass only existing beneficiary
    function calculateProfitAndStage(address beneficiary) private returns (BeneficiaryInfo memory) {
        BeneficiaryInfo storage vesting = whitelist[beneficiary];
        if (block.timestamp > lockupEnd) {
            uint96 unlocked = _calculateClaim(vesting);
            vesting.tokensUnlocked += unlocked;
            vesting.tokensLocked -= unlocked;
            vesting.lastVestingUpdate = uint64(block.timestamp);
        }
        return vesting;
    }
}
