// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapAdapter} from "../interfaces/ISwapAdapter.sol";
import {Errors} from "../libraries/Errors.sol";

interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3Pool {
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

/// @title UniswapV3PoolAdapter
/// @notice Minimal exact-input swap straight against a canonical Uniswap V3 pool on Robinhood Chain
///         (factory 0x1f7d…2EfA). It uses the pool's own `swap` + callback, doesn't fork Uniswap and
///         doesn't encode Universal Router commands. VespersVault is the intended caller, and it
///         enforces session rules, oracle-deviation bounds and minOut on its side.
/// @dev The callback only accepts the pool this adapter is currently swapping against, so a random
///      contract can't pull funds through it.
contract UniswapV3PoolAdapter is ISwapAdapter {
    using SafeERC20 for IERC20;

    uint160 internal constant MIN_SQRT_RATIO_PLUS_ONE = 4295128740;
    uint160 internal constant MAX_SQRT_RATIO_MINUS_ONE = 1461446703485210103287273052203988822378723970341;

    IUniswapV3Factory public immutable factory;
    uint24 public immutable feeTier;
    address private _activePool;

    constructor(address factory_, uint24 feeTier_) {
        if (factory_ == address(0)) revert Errors.ZeroAddress();
        factory = IUniswapV3Factory(factory_);
        feeTier = feeTier_;
    }

    /// @inheritdoc ISwapAdapter
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address recipient)
        external
        returns (uint256 amountOut)
    {
        address pool = factory.getPool(tokenIn, tokenOut, feeTier);
        if (pool == address(0)) revert Errors.InvalidParam();
        if (amountIn == 0 || amountIn > uint256(type(int256).max)) revert Errors.InvalidParam();
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        bool zeroForOne = tokenIn < tokenOut;
        _activePool = pool;
        (int256 a0, int256 a1) = IUniswapV3Pool(pool).swap(
            recipient,
            zeroForOne,
            int256(amountIn),
            zeroForOne ? MIN_SQRT_RATIO_PLUS_ONE : MAX_SQRT_RATIO_MINUS_ONE,
            abi.encode(tokenIn)
        );
        _activePool = address(0);

        int256 outDelta = zeroForOne ? a1 : a0;
        amountOut = uint256(-outDelta);
        if (amountOut < minAmountOut) revert Errors.Slippage(amountOut, minAmountOut);

        // Exact-input can leave input unspent if the price limit was hit; return it.
        uint256 left = IERC20(tokenIn).balanceOf(address(this));
        if (left != 0) IERC20(tokenIn).safeTransfer(msg.sender, left);
    }

    /// @notice Uniswap V3 swap callback: pays the pool the input owed.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        if (msg.sender != _activePool) revert Errors.InvalidParam();
        address tokenIn = abi.decode(data, (address));
        uint256 owed = uint256(amount0Delta > 0 ? amount0Delta : amount1Delta);
        IERC20(tokenIn).safeTransfer(msg.sender, owed);
    }
}
