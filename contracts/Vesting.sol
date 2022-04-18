// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "./openzeppelin/contracts/token/ERC20/IERC20.sol";

abstract contract Vesting {
    address public owner;
    address public dao;
    bool initialized;
    uint96 public tokensLocked;
    uint96 public tokensPerSec;
    uint96 public tokensClaimed;
    uint64 public vestingStart;
    uint64 public vestingFinish;
    IERC20 public token;

    event TokensClaimed(address indexed from, address indexed to, uint256 amount);

    function vestingDuration() public pure virtual returns (uint64);

    function initialize(address _token, uint64 _vestingStart) external onlyOwnerOrDao {
        require(!initialized, "Already initialized");
        initialized = true;
        vestingStart = _vestingStart;
        vestingFinish = vestingStart + vestingDuration();
        token = IERC20(_token);
        tokensLocked = uint96(token.balanceOf(address(this)));
        tokensPerSec = tokensLocked / vestingDuration();
    }

    function calculateClaim() public view returns (uint96) {
        if (block.timestamp < vestingFinish) {
            return (uint64(block.timestamp) - vestingStart) * tokensPerSec - tokensClaimed;
        }
        return tokensLocked;
    }

    function claim(address to, uint96 amount) external onlyOwnerOrDao {
        uint96 unlocked = calculateClaim();
        require(unlocked >= amount, "Requested more than unlocked");
        require(tokensLocked >= amount, "Calculated more tokens than available");
        tokensLocked -= amount;
        tokensClaimed += amount;

        token.transfer(to, amount);
        emit TokensClaimed(msg.sender, to, amount);
    }

    function transferAuthority(address newOwner) external onlyOwnerOrDao {
        owner = newOwner;
    }

    function setDaoAddress(address newDao) external onlyOwnerOrDao {
        dao = newDao;
    }

    modifier onlyOwnerOrDao() {
        require(msg.sender == owner || msg.sender == dao, "Not allowed");
        _;
    }
}
