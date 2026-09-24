// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @notice Robinhood Stock Token surface used by Amen (ERC-20 + ERC-8056 UI multiplier).
/// @dev Raw balanceOf is NOT a share count. Share-equivalent = raw * uiMultiplier() / 1e18.
///      `oraclePaused()` exists on some tokens only, so always call it via low-level staticcall.
interface IStockToken is IERC20Metadata {
    function uiMultiplier() external view returns (uint256);
    function newUIMultiplier() external view returns (uint256);
    function effectiveAt() external view returns (uint256);
    function balanceOfUI(address account) external view returns (uint256);
    function totalSupplyUI() external view returns (uint256);
    function oraclePaused() external view returns (bool);

    event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp);
}
