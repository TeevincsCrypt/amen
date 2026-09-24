// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Hostile 6-decimal "USDG" that calls back into a target during transfers, to prove the
///         ReentrancyGuard on vault/market exits.
contract ReentrantUSDG is ERC20 {
    address public hookTarget;
    bytes public hookData;
    bool public reentered;
    bytes public reentryRevertData;

    constructor() ERC20("Evil USDG", "USDG") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target, bytes calldata data) external {
        hookTarget = target;
        hookData = data;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        address t = hookTarget;
        if (t != address(0) && from == t) {
            hookTarget = address(0); // one shot
            (bool ok, bytes memory ret) = t.call(hookData);
            reentered = true;
            if (!ok) {
                reentryRevertData = ret;
                // bubble so the outer call fails too
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }
    }
}
