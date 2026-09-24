// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {UniswapV3PoolAdapter} from "../../src/adapters/UniswapV3PoolAdapter.sol";
import {MockUSDG} from "../../src/mocks/MockUSDG.sol";
import {MockStockToken} from "../../src/mocks/MockStockToken.sol";
import {Errors} from "../../src/libraries/Errors.sol";

/// @dev Fixed-price pool that follows the Uniswap V3 swap/callback protocol (exact input only).
contract FakePool {
    address public token0;
    address public token1;
    uint256 public px1Per0Wad; // amount of token1 per 1 token0 unit, WAD

    constructor(address a, address b, uint256 px) {
        (token0, token1) = a < b ? (a, b) : (b, a);
        px1Per0Wad = px;
    }

    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160, bytes calldata data)
        external
        returns (int256 a0, int256 a1)
    {
        uint256 amtIn = uint256(amountSpecified);
        uint256 out = zeroForOne ? amtIn * px1Per0Wad / 1e18 : amtIn * 1e18 / px1Per0Wad;
        address tOut = zeroForOne ? token1 : token0;
        address tIn = zeroForOne ? token0 : token1;
        MockUSDG(tOut).mint(recipient, out); // both mocks expose mint(address,uint256)
        (a0, a1) = zeroForOne ? (int256(amtIn), -int256(out)) : (-int256(out), int256(amtIn));
        uint256 before = MockUSDG(tIn).balanceOf(address(this));
        UniswapV3PoolAdapter(msg.sender).uniswapV3SwapCallback(a0, a1, data);
        require(MockUSDG(tIn).balanceOf(address(this)) - before >= amtIn, "not paid");
    }
}

contract FakeFactory {
    mapping(bytes32 => address) pools;

    function set(address a, address b, uint24 fee, address p) external {
        pools[keccak256(abi.encode(a < b ? a : b, a < b ? b : a, fee))] = p;
    }

    function getPool(address a, address b, uint24 fee) external view returns (address) {
        return pools[keccak256(abi.encode(a < b ? a : b, a < b ? b : a, fee))];
    }
}

contract UniswapV3PoolAdapterTest is Test {
    function test_SwapBothDirectionsAndCallbackAuth() public {
        MockUSDG usdg = new MockUSDG();
        MockStockToken nvda = new MockStockToken("N", "NVDA");
        FakeFactory f = new FakeFactory();
        // price: 1 raw NVDA (1e18) = 180 USDG (180e6); express as token1 per token0
        bool usdgIs0 = address(usdg) < address(nvda);
        uint256 px = usdgIs0 ? uint256(1e18) * 1e18 / 180e6 : uint256(180e6); // WAD-scaled ratio
        FakePool pool = new FakePool(address(usdg), address(nvda), px);
        f.set(address(usdg), address(nvda), 3000, address(pool));
        UniswapV3PoolAdapter ad = new UniswapV3PoolAdapter(address(f), 3000);

        usdg.mint(address(this), 360e6);
        usdg.approve(address(ad), type(uint256).max);
        uint256 out = ad.swap(address(usdg), address(nvda), 360e6, 1.99e18, address(this));
        assertApproxEqRel(out, 2e18, 1e12);

        nvda.approve(address(ad), type(uint256).max);
        uint256 back = ad.swap(address(nvda), address(usdg), out, 0, address(this));
        assertApproxEqAbs(back, 360e6, 1);

        vm.expectRevert(Errors.InvalidParam.selector);
        ad.uniswapV3SwapCallback(1, 0, abi.encode(address(usdg)));

        UniswapV3PoolAdapter noPool = new UniswapV3PoolAdapter(address(f), 500);
        vm.expectRevert(Errors.InvalidParam.selector); // no pool for this fee tier
        noPool.swap(address(usdg), address(nvda), 1, 0, address(this));
    }
}
