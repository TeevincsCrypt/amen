// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AmenOracle} from "../../src/AmenOracle.sol";
import {MockUSDG} from "../../src/mocks/MockUSDG.sol";
import {MockStockToken} from "../../src/mocks/MockStockToken.sol";
import {MockAggregator} from "../../src/mocks/MockAggregator.sol";
import {SessionLib} from "../../src/libraries/SessionLib.sol";

/// @notice Shared fixture: Robinhood chain id, mock USDG/NVDA/feed and an oracle wired together.
abstract contract AmenTestBase is Test {
    address internal owner = makeAddr("owner");
    address internal keeper = makeAddr("keeper");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal feeRecipient = makeAddr("feeRecipient");

    MockUSDG internal usdg;
    MockStockToken internal nvda;
    MockAggregator internal feed;
    AmenOracle internal oracle;

    int256 internal constant NVDA_PX_8 = 180_00000000; // $180.00 with 8 decimals
    uint256 internal constant NVDA_PX_18 = 180e18;

    // Freeze reasons (precomputed so vm.prank isn't consumed by a getter call)
    bytes32 internal constant R_STALE = "STALE";
    bytes32 internal constant R_PAUSED = "PAUSED";
    bytes32 internal constant R_NONPOSITIVE = "NONPOSITIVE";
    bytes32 internal constant R_MANUAL = "MANUAL";
    bytes32 internal constant R_FEED_ERROR = "FEED_ERROR";

    function setUp() public virtual {
        vm.chainId(4663);
        // Thursday 2026-09-24 12:00 UTC (08:00 NY, pre-market, EDT)
        vm.warp(utc(2026, 9, 24, 12, 0));
        usdg = new MockUSDG();
        nvda = new MockStockToken("NVIDIA Stock Token", "NVDA");
        feed = new MockAggregator(8, "NVDA / USD");
        oracle = new AmenOracle(owner);
        vm.startPrank(owner);
        oracle.setFeed(address(nvda), address(feed));
        oracle.setKeeper(keeper, true);
        vm.stopPrank();
    }

    /// @dev UTC timestamp helper.
    function utc(uint256 y, uint256 m, uint256 d, uint256 hh, uint256 mm) internal pure returns (uint256) {
        return SessionLib.daysFromCivil(y, m, d) * 1 days + hh * 1 hours + mm * 1 minutes;
    }

    function day(uint256 y, uint256 m, uint256 d) internal pure returns (uint256) {
        return SessionLib.daysFromCivil(y, m, d);
    }

    /// @dev Publish a feed round at the current block time.
    function tick(int256 px8) internal returns (uint80) {
        return feed.setAnswer(px8);
    }

    /// @dev Publish a feed round at `ts` (must be <= now when read).
    function tickAt(int256 px8, uint256 ts) internal returns (uint80) {
        return feed.pushRound(px8, ts);
    }
}
