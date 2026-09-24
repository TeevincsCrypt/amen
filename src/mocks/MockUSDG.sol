// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test/demo stand-in for USDG (Paxos Global Dollar). 6 decimals, like the real token.
contract MockUSDG is ERC20 {
    constructor() ERC20("Mock Global Dollar", "USDG") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Open faucet for local demos and tests only.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
