// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Swap venue used by VespersVault to move inventory. The vault approves `amountIn` and
///         checks both `minAmountOut` and its own balance deltas, so a bad adapter can't overstate fills.
interface ISwapAdapter {
    /// @notice Pulls `amountIn` of `tokenIn` from msg.sender and sends at least `minAmountOut` of `tokenOut` to `recipient`.
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address recipient)
        external
        returns (uint256 amountOut);
}
