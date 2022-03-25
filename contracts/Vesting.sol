// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "./openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Vesting {
    struct VestingInfo {
        // amount of locked tokens
        uint256 tokensLocked;
        // amount of tokens to be claimed (when buying a share p2p, amount of unlocked tokens of seller)
        uint256 tokensPending;
        // amount of unlocked tokens sold p2p
        uint256 tokensUnlockedSold;
        // sum of claimed tokens
        uint256 tokensClaimed;
        // amount of tokens unlocked per second
        uint256 tokensPerSec;
        // vesting start time (differ when the address is p2p buyer)
        uint256 startTime;
    }
    // immutable list of beneficiaries (+ p2p buyers)
    mapping(address => VestingInfo) private whitelist;
    // reserved list of beneficiaries added by owner after initialize
    mapping(address => VestingInfo) private whitelistReserve;
    // amount of tokens allocated for whitelist
    uint256 public whitelistTokensLimit;
    // amount of tokens allocated for reserved whitelist
    uint256 public whitelistReserveTokensLimit;
    uint256 public whitelistReserveTokensUsed;
    // date of start after lock-up period
    uint64 public startTime;
    // date of vesting finish
    uint64 public finishTime;

    // uint64 public constant MONTH = 30 days;
    // lock-up time
    uint64 public constant LOCKUP_TIME = 7948800;
    // vesting duration
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

    function initialize(address tokenAddress, address[] memory accounts, uint256[] memory tokenAmounts, uint8 reservePercent) external {
        require(msg.sender == owner, "Not allowed to initialize");
        require(startTime == 0, "Already initialized");
        token = IERC20(tokenAddress);
        startTime = uint64(block.timestamp) + LOCKUP_TIME;
        finishTime = startTime + DURATION;

        require(accounts.length == tokenAmounts.length, "Users and tokenAmounts length mismatch");
        require(accounts.length > 0, "No users");
        uint256 vestingBalance = token.balanceOf(address(this));
        require(vestingBalance > 0, "Zero token balance");
        whitelistTokensLimit = (vestingBalance / 100) * reservePercent;
        whitelistReserveTokensLimit = vestingBalance - whitelistTokensLimit;
        uint256 whitelistTokensSum;

        for (uint256 i = 0; i < accounts.length; i++) {
            address account = accounts[i];
            uint256 tokenAmount = tokenAmounts[i];
            require(account != address(0), "Address is zero");
            whitelistTokensSum += tokenAmount;
            require(whitelistTokensSum <= whitelistTokensLimit, "Exceeded tokens limit");
            whitelist[account] = VestingInfo(tokenAmount, 0, 0, 0, tokenAmount / DURATION, startTime);
        }
    }

    function addBeneficiary(address beneficiary, uint256 tokenAmount) external afterInitialize {
        require(msg.sender == owner, "Not allowed to add beneficiary");
        require(beneficiary != address(0), "Address is zero");
        require(whitelist[beneficiary].tokensPerSec == 0, "Beneficiary is already in the main whitelist");
        whitelistReserveTokensUsed += tokenAmount;
        require(whitelistReserveTokensUsed <= whitelistReserveTokensLimit, "Exceeded tokens limit");
        whitelistReserve[beneficiary] = VestingInfo(tokenAmount, 0, 0, 0, tokenAmount / DURATION, startTime);
    }

    function getBeneficiaryInfo(address beneficiary) public view returns (bool, VestingInfo memory) {
        if (whitelist[beneficiary].startTime > 0) {
            return (true, whitelist[beneficiary]);
        } else if (whitelistReserve[beneficiary].startTime > 0) {
            return (false, whitelistReserve[beneficiary]);
        } else {
            revert("Account is not in whitelist");
        }
    }

    function calculateClaim(address beneficiary) external view afterInitialize returns (uint256) {
        (, VestingInfo memory vesting) = getBeneficiaryInfo(beneficiary);

        return _calculateClaim(vesting);
    }

    function _calculateClaim(VestingInfo memory vesting) private view returns (uint256) {
        require(block.timestamp > vesting.startTime, "Cannot claim during 3 months lock-up period");

        if (block.timestamp < finishTime) {
            return (block.timestamp - vesting.startTime) * vesting.tokensPerSec - vesting.tokensClaimed + vesting.tokensPending;
        } else {
            return vesting.tokensLocked;
        }
    }

    function claim(uint256 amount) external {
        address sender = msg.sender;
        (bool inMainWhitelist, VestingInfo memory vesting) = getBeneficiaryInfo(sender);

        uint tokensToClaim = _calculateClaim(vesting);
        require(tokensToClaim >= amount, "Requested more than unlocked");

        if (inMainWhitelist) {
            if (vesting.tokensPending > 0) {
                if (amount <= vesting.tokensPending) {
                    whitelist[sender].tokensPending -= amount;
                } else {
                    whitelist[sender].tokensLocked -= amount - vesting.tokensPending;
                    whitelist[sender].tokensPending = 0;
                }
            } else {
                whitelist[sender].tokensLocked -= amount;
            }
        } else {
            if (vesting.tokensPending > 0) {
                if (amount <= vesting.tokensPending) {
                    whitelistReserve[sender].tokensPending -= amount;
                } else {
                    whitelistReserve[sender].tokensLocked -= amount - vesting.tokensPending;
                    whitelistReserve[sender].tokensPending = 0;
                }
            } else {
                whitelistReserve[sender].tokensLocked -= amount;
            }
        }

        token.transfer(sender, amount);
    }

    function sellShare(address to, uint amountLocked, uint amountUnlocked) external afterInitialize {
        address sender = msg.sender;
        require(sender != to, "Cannot sell to the same address");
        (bool inMainWhitelist, VestingInfo memory vesting) = getBeneficiaryInfo(sender);

        uint unlocked = _calculateClaim(vesting);

        require(vesting.tokensLocked - unlocked >= amountLocked, "Requested more locked tokens than available");
        require(unlocked >= amountUnlocked, "Requested more unlocked tokens than available");

        if (inMainWhitelist) {
            whitelist[sender].tokensLocked -= amountLocked;
            whitelist[sender].tokensUnlockedSold += amountUnlocked;
            if (vesting.tokensPending > 0) {
                if (amountUnlocked <= vesting.tokensPending) {
                    whitelist[sender].tokensPending -= amountUnlocked;
                } else {
                    whitelist[sender].tokensLocked -= amountUnlocked - vesting.tokensPending;
                    whitelist[sender].tokensPending = 0;
                }
            } else {
                whitelist[sender].tokensLocked -= amountUnlocked;
            }
            whitelist[to] = VestingInfo(amountLocked, amountUnlocked, 0, 0, amountLocked / (finishTime - block.timestamp), block.timestamp);
        } else {
            whitelistReserve[sender].tokensLocked -= amountLocked;
            whitelistReserve[sender].tokensUnlockedSold += amountUnlocked;
            if (vesting.tokensPending > 0) {
                if (amountUnlocked <= vesting.tokensPending) {
                    whitelistReserve[sender].tokensPending -= amountUnlocked;
                } else {
                    whitelistReserve[sender].tokensLocked -= amountUnlocked - vesting.tokensPending;
                    whitelistReserve[sender].tokensPending = 0;
                }
            } else {
                whitelistReserve[sender].tokensLocked -= amountUnlocked;
            }
            whitelistReserve[to] = VestingInfo(amountLocked, amountUnlocked, 0, 0, amountLocked / (finishTime - block.timestamp), block.timestamp);
        }
    }
}
