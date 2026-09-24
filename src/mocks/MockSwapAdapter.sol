// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MockUSDG} from "./MockUSDG.sol";
import {MockStockToken} from "./MockStockToken.sol";

/// @notice Fixed-price USDG<->stock venue for tests and the local demo. It mints the output token,
///         so it needs no liquidity. `priceWad` is USD per raw stock token (18 decimals).
contract MockSwapAdapter {
    using SafeERC20 for IERC20;

    address public immutable usdg;
    address public immutable stock;
    uint256 public priceWad;

    constructor(address usdg_, address stock_, uint256 priceWad_) {
        usdg = usdg_;
        stock = stock_;
        priceWad = priceWad_;
    }

    function setPrice(uint256 p) external {
        priceWad = p;
    }

    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external returns (uint256 amountOut) {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        if (tokenIn == usdg && tokenOut == stock) {
            // USDG(6) -> stock(18): out = in * 1e12 * 1e18 / price
            amountOut = Math.mulDiv(amountIn * 1e12, 1e18, priceWad);
            MockStockToken(stock).mint(recipient, amountOut);
        } else if (tokenIn == stock && tokenOut == usdg) {
            amountOut = Math.mulDiv(amountIn, priceWad, 1e18) / 1e12;
            MockUSDG(usdg).mint(recipient, amountOut);
        } else {
            revert("MockSwapAdapter: pair");
        }
        require(amountOut >= minAmountOut, "MockSwapAdapter: slippage");
    }
}
