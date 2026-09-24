// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IStockToken} from "../../src/interfaces/IStockToken.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {AmenOracle} from "../../src/AmenOracle.sol";
import {IAmenOracle} from "../../src/interfaces/IAmenOracle.sol";
import {VespersVault} from "../../src/VespersVault.sol";
import {AmenMarket} from "../../src/AmenMarket.sol";

/// @notice Live Robinhood Chain (4663) checks against the real NVDA, USDG and Chainlink bytecode.
///         Run with: forge test --match-path test/fork/* --fork-url $RH_RPC -vv
///         These tests skip themselves when not running on a 4663 fork.
contract RobinhoodForkTest is Test {
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address constant NVDA_FEED = 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15;
    address constant UNI_V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;

    function setUp() public {
        if (block.chainid != 4663) {
            vm.skip(true);
        }
    }

    function test_Fork_BytecodePresent() public view {
        assertGt(USDG.code.length, 0, "USDG code");
        assertGt(NVDA.code.length, 0, "NVDA code");
        assertGt(NVDA_FEED.code.length, 0, "feed code");
        assertGt(UNI_V3_FACTORY.code.length, 0, "factory code");
    }

    function test_Fork_UsdgIs6Decimals() public view {
        assertEq(IERC20Metadata(USDG).decimals(), 6, "USDG must be 6 decimals");
        console2.log("USDG symbol", IERC20Metadata(USDG).symbol());
    }

    function test_Fork_NvdaStockToken() public view {
        IStockToken t = IStockToken(NVDA);
        string memory sym = t.symbol();
        console2.log("NVDA symbol", sym);
        assertGt(bytes(sym).length, 0);
        assertEq(t.decimals(), 18, "Stock Tokens are 18 decimals");
        uint256 m = t.uiMultiplier();
        console2.log("NVDA uiMultiplier", m);
        assertGt(m, 0);
        // oraclePaused may not exist; probe via staticcall
        (bool ok, bytes memory ret) =
            NVDA.staticcall(abi.encodeWithSelector(IStockToken.oraclePaused.selector));
        console2.log("oraclePaused selector exists", ok && ret.length >= 32);
    }

    function test_Fork_NvdaFeed() public view {
        IAggregatorV3 f = IAggregatorV3(NVDA_FEED);
        uint8 dec = f.decimals();
        (uint80 rid, int256 answer,, uint256 updatedAt,) = f.latestRoundData();
        console2.log("feed decimals", dec);
        console2.log("roundId", uint256(rid));
        console2.logInt(answer);
        console2.log("updatedAt", updatedAt, "age s", block.timestamp - updatedAt);
        assertGt(answer, 0);
        assertGt(updatedAt, 0);
    }

    function test_Fork_DeployAndMark() public {
        address owner = makeAddr("owner");
        AmenOracle oracle = new AmenOracle(owner);
        vm.prank(owner);
        oracle.setFeed(NVDA, NVDA_FEED);
        IAmenOracle.Mark memory m = oracle.getMark(NVDA);
        console2.log("mark priceUsd (1e18)", m.priceUsd);
        console2.log("cashOpen", m.cashOpen, "frozen", m.frozen);
        assertGt(m.priceUsd, 0);

        VespersVault vault = new VespersVault(owner, USDG, NVDA, address(oracle), owner);
        AmenMarket market = new AmenMarket(owner, USDG, address(oracle), owner);
        assertEq(vault.decimals(), 18);
        assertEq(address(market.usdg()), USDG);
    }
}
