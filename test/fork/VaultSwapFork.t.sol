// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AmenOracle} from "../../src/AmenOracle.sol";
import {IAmenOracle} from "../../src/interfaces/IAmenOracle.sol";
import {VespersVault} from "../../src/VespersVault.sol";
import {UniswapV3PoolAdapter} from "../../src/adapters/UniswapV3PoolAdapter.sol";
import {Errors} from "../../src/libraries/Errors.sol";

/// @notice The "tiny live test" for vault trading, on a fork of Robinhood Chain (4663): real
///         swaps through the real NVDA/USDG Uniswap V3 pool via UniswapV3PoolAdapter, then the
///         vault's own buy and flatten with its 50 bps oracle check. Nothing is broadcast and no
///         real funds move: test USDG is borrowed from the pool's balance inside the fork.
///         forge test --match-contract VaultSwapForkTest --fork-url $RH_RPC -vv
///         Skips itself unless block.chainid == 4663.
contract VaultSwapForkTest is Test {
    address usdg;
    address nvda;
    address feed;
    address factory;
    address pool;
    uint24 feeTier;

    AmenOracle oracle;
    UniswapV3PoolAdapter adapter;
    address owner = makeAddr("owner");

    function setUp() public {
        if (block.chainid != 4663) {
            vm.skip(true);
            return;
        }
        string memory cfg = vm.readFile(string.concat(vm.projectRoot(), "/config/4663.json"));
        usdg = vm.parseJsonAddress(cfg, ".usdg");
        nvda = vm.parseJsonAddress(cfg, ".nvda");
        feed = vm.parseJsonAddress(cfg, ".nvdaFeed");
        factory = vm.parseJsonAddress(cfg, ".uniswapV3Factory");
        pool = vm.parseJsonAddress(cfg, ".nvdaUsdgPool");
        feeTier = uint24(vm.parseJsonUint(cfg, ".uniswapFeeTier"));

        oracle = new AmenOracle(owner);
        vm.prank(owner);
        oracle.setFeed(nvda, feed);
        adapter = new UniswapV3PoolAdapter(factory, feeTier);
    }

    /// Swap 10 / 100 / 1,000 USDG into NVDA and straight back. Logs each execution price against
    /// the Chainlink mark and the round-trip cost. Asserts only that the swap path works.
    function test_Fork_AdapterRoundTrip() public {
        uint256 mark = oracle.getMark(nvda).priceUsd;
        uint256 poolUsdg = IERC20(usdg).balanceOf(pool);
        console2.log("pool USDG balance (6 dec)", poolUsdg);
        console2.log("NVDA mark, USD x1e18    ", mark);
        console2.log("cash open", oracle.isCashOpen(), "vespers", oracle.isVespers());

        uint256[3] memory sizes = [uint256(10e6), 100e6, 1_000e6];
        for (uint256 i; i < sizes.length; ++i) {
            uint256 amt = sizes[i];
            if (amt > poolUsdg / 10) {
                console2.log("skip size (pool too shallow for a fair test), USDG:", amt / 1e6);
                continue;
            }
            uint256 snap = vm.snapshotState();
            _borrowUsdg(amt);

            IERC20(usdg).approve(address(adapter), amt);
            uint256 out = adapter.swap(usdg, nvda, amt, 0, address(this));
            assertGt(out, 0, "no NVDA out");
            uint256 buyPx = amt * 1e12 * 1e18 / out;

            IERC20(nvda).approve(address(adapter), out);
            uint256 back = adapter.swap(nvda, usdg, out, 0, address(this));
            assertGt(back, 0, "no USDG back");

            console2.log("--- size USDG", amt / 1e6);
            console2.log("buy price, USD x1e18    ", buyPx);
            _logBps("buy vs mark, bps (+ = above)", int256(buyPx) - int256(mark), mark);
            console2.log("within the vault's 50 bps band:", buyPx <= mark * 10_050 / 10_000);
            _logBps("round-trip cost, bps", int256(amt) - int256(back), amt);
            vm.revertToState(snap);
        }
    }

    /// The vault's real buy and flatten against the pool, in Vespers. A PriceDeviation revert is a
    /// pass: it means the pool is more than 50 bps from the mark right now and the vault refuses
    /// to trade, which is the safety rule working.
    function test_Fork_VaultBuyAndFlatten() public {
        if (!oracle.isVespers()) {
            uint256 close = oracle.nextCloseAfter(block.timestamp);
            vm.warp(close + 60);
            console2.log("warped to Vespers (60 s after the next close)", block.timestamp);
        }
        assertTrue(oracle.isVespers(), "not Vespers");
        IAmenOracle.Mark memory m = oracle.getMark(nvda);
        assertFalse(m.frozen, "NVDA mark is frozen on this fork");

        VespersVault vault = new VespersVault(owner, usdg, nvda, address(oracle), owner);
        vm.prank(owner);
        vault.setSwapAdapter(address(adapter));

        _borrowUsdg(200e6);
        IERC20(usdg).approve(address(vault), 200e6);
        vault.deposit(200e6, address(this));
        vault.startCycle();

        vm.prank(owner);
        try vault.buyInventory(20e6, 0) returns (uint256 got) {
            console2.log("vault bought NVDA raw", got);
            assertEq(vault.stockHeld(), got);
            uint256 navAfterBuy = vault.totalAssets();
            console2.log("NAV after buy (6 dec)", navAfterBuy);

            vm.prank(owner);
            try vault.flatten(0) returns (uint256 usdgBack) {
                console2.log("vault flattened, USDG back (6 dec)", usdgBack);
                assertEq(vault.stockHeld(), 0);
                _logBps("round-trip cost, bps", int256(20e6) - int256(usdgBack), 20e6);
            } catch (bytes memory err) {
                _expectDeviation(err, "flatten");
            }
        } catch (bytes memory err) {
            _expectDeviation(err, "buy");
        }
    }

    // Borrow test USDG from the pool's own balance. Only inside this fork: nothing is broadcast.
    function _borrowUsdg(uint256 amt) internal {
        vm.prank(pool);
        IERC20(usdg).transfer(address(this), amt);
    }

    function _expectDeviation(bytes memory err, string memory what) internal pure {
        bytes4 sel = bytes4(err);
        require(sel == Errors.PriceDeviation.selector, string.concat(what, ": unexpected revert"));
        (uint256 exec, uint256 mark) = abi.decode(_tail(err), (uint256, uint256));
        console2.log(string.concat(what, " refused: pool more than 50 bps from the mark (safety rule)"));
        console2.log("exec price x1e18", exec);
        console2.log("mark price x1e18", mark);
    }

    function _tail(bytes memory err) internal pure returns (bytes memory out) {
        out = new bytes(err.length - 4);
        for (uint256 i; i < out.length; ++i) {
            out[i] = err[i + 4];
        }
    }

    function _logBps(string memory label, int256 diff, uint256 base) internal pure {
        console2.log(label);
        console2.logInt(diff * 10_000 / int256(base));
    }
}
