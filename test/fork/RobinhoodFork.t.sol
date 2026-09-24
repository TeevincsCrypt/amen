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
import {IUniswapV3Factory} from "../../src/adapters/UniswapV3PoolAdapter.sol";

interface IPoolView {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
}

/// @notice Live Robinhood Chain (4663) checks against real NVDA / USDG / Chainlink / Uniswap bytecode.
///         Addresses come from config/4663.json. See docs/VERIFY.md.
///         forge test --match-path 'test/fork/*' --fork-url $RH_RPC -vv
///         Skips itself unless block.chainid == 4663.
contract RobinhoodForkTest is Test {
    address usdg;
    address nvda;
    address feed;
    address factory;
    address pool;
    uint24 feeTier;

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
    }

    function test_Fork_BytecodePresent() public view {
        assertGt(usdg.code.length, 0, "USDG code");
        assertGt(nvda.code.length, 0, "NVDA code");
        assertGt(feed.code.length, 0, "feed code");
        assertGt(factory.code.length, 0, "factory code");
        assertGt(pool.code.length, 0, "pool code");
    }

    function test_Fork_UsdgIs6Decimals() public view {
        assertEq(IERC20Metadata(usdg).decimals(), 6, "USDG must be 6 decimals");
        console2.log("USDG symbol", IERC20Metadata(usdg).symbol());
    }

    function test_Fork_NvdaStockToken() public view {
        IStockToken t = IStockToken(nvda);
        console2.log("NVDA symbol", t.symbol());
        assertEq(t.decimals(), 18, "Stock Tokens are 18 decimals");
        uint256 m = t.uiMultiplier();
        console2.log("NVDA uiMultiplier", m); // expected ~1.000775e18 at time of writing
        assertGt(m, 0);
        // oraclePaused() exists on NVDA and must be callable; Amen freezes if it returns true.
        (bool ok, bytes memory ret) =
            nvda.staticcall(abi.encodeWithSelector(IStockToken.oraclePaused.selector));
        assertTrue(ok && ret.length >= 32, "oraclePaused() selector missing");
        console2.log("oraclePaused", abi.decode(ret, (bool)));
    }

    function test_Fork_NvdaFeed() public view {
        IAggregatorV3 f = IAggregatorV3(feed);
        assertEq(f.decimals(), 8, "feed decimals");
        (uint80 rid, int256 answer,, uint256 updatedAt,) = f.latestRoundData();
        console2.log("roundId", uint256(rid));
        console2.logInt(answer);
        console2.log("updatedAt", updatedAt, "age s", block.timestamp - updatedAt);
        assertGt(answer, 0);
        // Settlement relies on getRoundData(roundId - 1) within a phase.
        (, int256 prevAnswer,, uint256 prevUpdatedAt,) = f.getRoundData(rid - 1);
        assertGt(prevAnswer, 0, "prev round answer");
        assertLt(prevUpdatedAt, updatedAt + 1, "prev round ordering");
    }

    function test_Fork_UniswapPool() public view {
        assertEq(
            IUniswapV3Factory(factory).getPool(usdg, nvda, feeTier),
            pool,
            "factory.getPool != configured pool"
        );
        IPoolView p = IPoolView(pool);
        assertEq(p.fee(), feeTier, "pool fee");
        (address a, address b) = usdg < nvda ? (usdg, nvda) : (nvda, usdg);
        assertEq(p.token0(), a);
        assertEq(p.token1(), b);
    }

    function test_Fork_DeployAndMark() public {
        address owner = makeAddr("owner");
        AmenOracle oracle = new AmenOracle(owner);
        vm.prank(owner);
        oracle.setFeed(nvda, feed);
        IAmenOracle.Mark memory m = oracle.getMark(nvda);
        console2.log("mark priceUsd (1e18)", m.priceUsd);
        console2.log("cashOpen", m.cashOpen, "frozen", m.frozen);
        assertGt(m.priceUsd, 0);
        assertFalse(oracle.isStockPaused(nvda), "NVDA oracle currently paused");

        VespersVault vault = new VespersVault(owner, usdg, nvda, address(oracle), owner);
        AmenMarket market = new AmenMarket(owner, usdg, address(oracle), owner);
        assertEq(vault.decimals(), 18);
        assertEq(vault.maxDeviationBps(), 50);
        assertEq(address(market.usdg()), usdg);
    }
}
