// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test/demo Stock Token implementing the ERC-8056 UI-multiplier surface and oraclePaused().
/// @dev Real Stock Tokens can only be minted by Authorized Participants. This mock mints freely,
///      for local/testnet demos only.
contract MockStockToken is ERC20 {
    uint256 public uiMultiplier = 1e18;
    uint256 public newUIMultiplier = 1e18;
    uint256 public effectiveAt;
    bool public oraclePaused;

    event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp);

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function balanceOfUI(address account) external view returns (uint256) {
        return balanceOf(account) * uiMultiplier / 1e18;
    }

    function totalSupplyUI() external view returns (uint256) {
        return totalSupply() * uiMultiplier / 1e18;
    }

    /// @notice Simulates a corporate action (e.g. a 2:1 split sets 2e18). Applied immediately in the mock.
    function setUIMultiplier(uint256 m) external {
        emit UIMultiplierUpdated(uiMultiplier, m, block.timestamp);
        uiMultiplier = m;
        newUIMultiplier = m;
        effectiveAt = block.timestamp;
    }

    function setOraclePaused(bool p) external {
        oraclePaused = p;
    }
}

/// @notice A Stock Token variant without `oraclePaused()`, to prove Amen tolerates the missing selector.
contract MockStockTokenNoPause is ERC20 {
    constructor() ERC20("No Pause Stock", "NOPAUSE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function uiMultiplier() external pure returns (uint256) {
        return 1e18;
    }
}
