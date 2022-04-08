// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "./openzeppelin/contracts/token/ERC20/IERC20.sol";

struct BeneficiaryInit {
    address account;
    uint96 tokenAmount;
}

contract InsidersVesting {
    struct BeneficiaryInfo {
        uint64 startTime;
        uint96 tokensLocked;
        uint96 tokensUnlocked;
        uint96 tokensClaimed;
        uint96 tokensLockedTransferred;
        uint96 tokensUnlockedTransferred;
        // amount of tokens unlocked per second
        uint96 tokensPerSec;
        // date of pulling unlocked tokens from locked (transfer, claim)
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

    modifier onlyFromWhitelist() {
        require(whitelist[msg.sender].lastVestingUpdate > 0, "You are not in whitelist");
        _;
    }

    function initialize(
        address tokenAddress,
        BeneficiaryInit[] memory beneficiaries,
        uint64 _vestingStart
    ) external {
        require(msg.sender == owner, "Not allowed to initialize");
        require(!initialized, "Already initialized");
        initialized = true;
        require(beneficiaries.length > 0, "No users");
        token = IERC20(tokenAddress);
        require(token.balanceOf(address(this)) >= TOKENS_TOTAL, "Insufficient token balance");
        vestingStart = _vestingStart;
        lockupEnd = _vestingStart + VESTING_LOCKUP_DURATION;
        vestingFinish = _vestingStart + VESTING_LOCKUP_DURATION + VESTING_DURATION;
        uint96 whitelistTokensSum;

        for (uint96 i = 0; i < beneficiaries.length; i++) {
            BeneficiaryInit memory b = beneficiaries[i]; 
            whitelistTokensSum += b.tokenAmount;
            require(whitelistTokensSum <= TOKENS_TOTAL, "Exceeded tokens limit");
            whitelist[b.account] = BeneficiaryInfo(_vestingStart, b.tokenAmount, 0, 0, 0, 0, b.tokenAmount / VESTING_DURATION, lockupEnd);
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
        BeneficiaryInfo memory info = getBeneficiaryInfo(beneficiary);

        return _calculateClaim(info) + info.tokensUnlocked;
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
        BeneficiaryInfo memory claimer = calculateClaimAndStage(sender);
        require(claimer.tokensUnlocked >= amount, "Requested more than unlocked");

        whitelist[sender].tokensUnlocked -= amount;
        whitelist[sender].tokensClaimed += amount;
        token.transfer(to, amount);
        emit TokensClaimed(to, amount);
    }

    function transfer(
        address to,
        uint96 lockedTokens,
        uint96 unlockedTokens
    ) external onlyFromWhitelist {
        BeneficiaryInfo memory sender = calculateClaimAndStage(msg.sender);
        require(sender.tokensLocked >= lockedTokens, "Requested more tokens than locked");
        require(sender.tokensUnlocked >= unlockedTokens, "Requested more tokens than unlocked");
        _transfer(to, lockedTokens, unlockedTokens);
    }

    function transferAll(address to) external onlyFromWhitelist {
        BeneficiaryInfo memory sender = calculateClaimAndStage(msg.sender);
        _transfer(to, sender.tokensLocked, sender.tokensUnlocked);
    }

    function _transfer(
        address to,
        uint96 lockedTokens,
        uint96 unlockedTokens
    ) private {
        require(msg.sender != to, "Cannot transfer to the same address");
        uint64 timestamp = uint64(block.timestamp);
        BeneficiaryInfo storage sender = whitelist[msg.sender];
        BeneficiaryInfo storage recipient = whitelist[to];

        sender.tokensLocked -= lockedTokens;
        sender.tokensLockedTransferred += lockedTokens;

        if (timestamp > lockupEnd) {
            sender.tokensUnlocked -= unlockedTokens;
            sender.tokensUnlockedTransferred += unlockedTokens;
            sender.tokensPerSec = sender.tokensLocked / (vestingFinish - timestamp);

            if (recipient.lastVestingUpdate == 0) {
                whitelist[to] = BeneficiaryInfo(
                    timestamp,
                    lockedTokens,
                    unlockedTokens,
                    0,
                    0,
                    0,
                    lockedTokens / (vestingFinish - timestamp),
                    timestamp
                );
            } else {
                calculateClaimAndStage(to);
                recipient.tokensLocked += lockedTokens;
                recipient.tokensUnlocked += unlockedTokens;
                recipient.tokensPerSec = recipient.tokensLocked / (vestingFinish - timestamp);
            }
        } else {
            sender.tokensPerSec = sender.tokensLocked / VESTING_DURATION;
            if (recipient.lastVestingUpdate == 0) {
                whitelist[to] = BeneficiaryInfo(timestamp, lockedTokens, 0, 0, 0, 0, lockedTokens / VESTING_DURATION, lockupEnd);
            } else {
                recipient.tokensLocked += lockedTokens;
                recipient.tokensPerSec = recipient.tokensLocked / VESTING_DURATION;
            }
        }
    }

    // pass only existing beneficiary
    function calculateClaimAndStage(address beneficiary) private returns (BeneficiaryInfo memory) {
        BeneficiaryInfo storage info = whitelist[beneficiary];
        if (block.timestamp > lockupEnd) {
            uint96 unlocked = _calculateClaim(info);
            info.tokensUnlocked += unlocked;
            info.tokensLocked -= unlocked;
            info.lastVestingUpdate = uint64(block.timestamp);
        }
        return info;
    }
}
