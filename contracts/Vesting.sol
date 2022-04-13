// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "./openzeppelin/contracts/token/ERC20/IERC20.sol";

abstract contract Vesting {
    address public owner;
    address public DAO;
    bool initialized;
    uint96 public tokensLocked;
    uint96 public tokensPerSec;
    uint96 public tokensClaimed;
    uint64 public vestingStart;
    uint64 public vestingFinish;
    IERC20 public token;

    event TokensClaimed(uint256 amount);

    function vestingDuration() public pure virtual returns (uint64);

    function initialize(address _token, uint64 _vestingStart) external onlyAdmin {
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

    function claim(uint96 amount) external onlyAdmin {
        uint96 unlocked = calculateClaim();
        require(unlocked >= amount, "Requested more than unlocked");
        tokensLocked -= amount;
        tokensClaimed += amount;

        token.transfer(msg.sender, amount);
        emit TokensClaimed(amount);
    }

    function transferAuthority(address to) external onlyAdmin {
        owner = to;
    }

    function setDAOAddress(address dao) external onlyAdmin {
        DAO = dao;
    }

    modifier onlyAdmin() {
        require(msg.sender == owner || msg.sender == DAO, "Not allowed");
        _;
    }
}
