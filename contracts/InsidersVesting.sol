// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "./openzeppelin/contracts/token/ERC20/IERC20.sol";

struct BeneficiaryInit {
    address account;
    uint96 tokenAmount;
}

struct BeneficiaryInfo {
    uint64 startTime;
    uint96 tokensLocked;
    uint96 tokensUnlocked;
    uint96 tokensClaimed;
    // amount of tokens unlocked per second
    uint96 tokensPerSec;
    // date of pulling unlocked tokens from locked (transfer, claim)
    uint64 lastVestingUpdate;
}

contract InsidersVesting {
    mapping(address => BeneficiaryInfo) private whitelist;
    address public immutable owner;
    bool public initialized;
    uint64 public vestingStart;
    uint64 public lockupEnd;
    uint64 public vestingFinish;

    uint64 public constant VESTING_LOCKUP_DURATION = 90 days;
    uint64 public constant VESTING_DURATION = 86745600; // 33 months

    IERC20 public token;

    event TokensClaimed(address indexed from, address indexed to, uint256 amount);
    event TokensTransferred(address indexed from, address indexed to, uint256 amountLocked, uint256 amountUnlocked);

    constructor(address _owner) {
        owner = _owner;
    }

    // pass only existing beneficiary
    function _calculateClaimAndStage(address beneficiary) private returns (BeneficiaryInfo memory) {
        BeneficiaryInfo storage info = whitelist[beneficiary];
        if (block.timestamp > lockupEnd) {
            uint96 unlocked = _calculateClaim(info);
            info.tokensUnlocked += unlocked;
            info.tokensLocked -= unlocked;
            info.lastVestingUpdate = uint64(block.timestamp);
        }
        return info;
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

    function getBeneficiaryInfo(address beneficiary) public view returns (BeneficiaryInfo memory) {
        if (whitelist[beneficiary].lastVestingUpdate > 0) {
            return whitelist[beneficiary];
        } else {
            revert("Account is not in whitelist");
        }
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
        uint96 tokensLimitRemaining = uint96(token.balanceOf(address(this)));
        require(tokensLimitRemaining > 0, "Zero token balance");
        require(_vestingStart > block.timestamp, "Start timestamp is in the past");
        vestingStart = _vestingStart;
        lockupEnd = _vestingStart + VESTING_LOCKUP_DURATION;
        vestingFinish = _vestingStart + VESTING_LOCKUP_DURATION + VESTING_DURATION;

        for (uint96 i = 0; i < beneficiaries.length; i++) {
            BeneficiaryInit memory b = beneficiaries[i];
            require(tokensLimitRemaining >= b.tokenAmount, "Tokens sum is greater than balance");
            tokensLimitRemaining -= b.tokenAmount;
            whitelist[b.account] = BeneficiaryInfo(_vestingStart, b.tokenAmount, 0, 0, b.tokenAmount / VESTING_DURATION, lockupEnd);
        }
        require(tokensLimitRemaining == 0, "Not all tokens are distributed");
    }

    function calculateClaim(address beneficiary) external view returns (uint96) {
        BeneficiaryInfo memory info = getBeneficiaryInfo(beneficiary);

        return _calculateClaim(info) + info.tokensUnlocked;
    }

    function claim(address to, uint96 amount) external onlyFromWhitelist {
        require(block.timestamp > lockupEnd, "Cannot claim during 3 months lock-up period");
        address sender = msg.sender;
        _calculateClaimAndStage(sender);
        BeneficiaryInfo storage claimer = whitelist[sender];
        require(claimer.tokensUnlocked >= amount, "Requested more than unlocked");

        claimer.tokensUnlocked -= amount;
        claimer.tokensClaimed += amount;
        token.transfer(to, amount);
        emit TokensClaimed(sender, to, amount);
    }

    function transfer(
        address to,
        uint96 tokensLocked,
        uint96 tokensUnlocked
    ) external onlyFromWhitelist {
        BeneficiaryInfo memory sender = _calculateClaimAndStage(msg.sender);
        require(sender.tokensLocked >= tokensLocked, "Requested more tokens than locked");
        require(sender.tokensUnlocked >= tokensUnlocked, "Requested more tokens than unlocked");
        _transfer(to, tokensLocked, tokensUnlocked);
    }

    function transferAll(address to) external onlyFromWhitelist {
        BeneficiaryInfo memory sender = _calculateClaimAndStage(msg.sender);
        _transfer(to, sender.tokensLocked, sender.tokensUnlocked);
    }

    function _transfer(
        address to,
        uint96 tokensLocked,
        uint96 tokensUnlocked
    ) private {
        require(msg.sender != to, "Cannot transfer to the same address");
        uint64 timestamp = uint64(block.timestamp);
        BeneficiaryInfo storage sender = whitelist[msg.sender];
        BeneficiaryInfo storage recipient = whitelist[to];

        sender.tokensLocked -= tokensLocked;
        uint64 durationLeft;
        uint64 lastVestingUpdate;
        if (timestamp > lockupEnd) {
            // set durationLeft = 1 after vesting finish to avoid division by zero
            durationLeft = vestingFinish > timestamp ? vestingFinish - timestamp : 1;
            lastVestingUpdate = timestamp;
        } else {
            durationLeft = VESTING_DURATION;
            lastVestingUpdate = lockupEnd;
        }
        sender.tokensUnlocked -= tokensUnlocked;
        sender.tokensPerSec = sender.tokensLocked / durationLeft;
        if (recipient.lastVestingUpdate == 0) {
            whitelist[to] = BeneficiaryInfo(timestamp, tokensLocked, tokensUnlocked, 0, tokensLocked / durationLeft, lastVestingUpdate);
        } else {
            _calculateClaimAndStage(to);
            recipient.tokensLocked += tokensLocked;
            recipient.tokensUnlocked += tokensUnlocked;
            recipient.tokensPerSec = recipient.tokensLocked / durationLeft;
        }
        emit TokensTransferred(msg.sender, to, tokensLocked, tokensUnlocked);
    }

    modifier onlyFromWhitelist() {
        require(whitelist[msg.sender].lastVestingUpdate > 0, "You are not in whitelist");
        _;
    }
}
