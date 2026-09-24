// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AmenTestBase} from "../utils/AmenTestBase.sol";
import {ReentrantUSDG} from "../utils/ReentrantUSDG.sol";
import {AmenMarket} from "../../src/AmenMarket.sol";
import {Errors} from "../../src/libraries/Errors.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MockStockToken} from "../../src/mocks/MockStockToken.sol";
import {MockAggregator} from "../../src/mocks/MockAggregator.sol";

contract AmenMarketTest is AmenTestBase {
    AmenMarket market;
    uint256 fri; // session id of Friday 2026-09-25
    uint256 monOpen;

    function setUp() public override {
        super.setUp();
        market = new AmenMarket(owner, address(usdg), address(oracle), feeRecipient);
        vm.startPrank(owner);
        market.setStockAllowed(address(nvda), true);
        market.setKeeper(keeper, true);
        vm.stopPrank();

        fri = day(2026, 9, 25);
        monOpen = utc(2026, 9, 28, 13, 30);

        // Friday close mark $180 recorded after the bell
        tickAt(NVDA_PX_8, utc(2026, 9, 25, 19, 55));
        vm.warp(utc(2026, 9, 25, 20, 5));
        oracle.recordSessionClose(address(nvda));

        for (uint256 i; i < 3; ++i) {
            address u = [alice, bob, carol][i];
            usdg.mint(u, 10_000e6);
            vm.prank(u);
            usdg.approve(address(market), type(uint256).max);
        }
    }

    function _gap(uint256 strike) internal returns (uint256 id) {
        vm.prank(keeper);
        id = market.createGapMarket(address(nvda), fri, strike, 0, 100_000e6);
    }

    function _buy(address u, uint256 id, bool yes, uint256 amt) internal {
        vm.prank(u);
        market.buy(id, yes, amt);
    }

    /// @dev Monday open print at `px8`, `minsAfterOpen` after 09:30 NY, then warp 5 min later.
    function _openPrint(int256 px8, uint256 minsAfterOpen) internal {
        vm.warp(monOpen + minsAfterOpen * 1 minutes);
        tick(px8);
        vm.warp(block.timestamp + 5 minutes);
    }

    // ───────────── creation ─────────────

    function test_CreateGapMarket() public {
        uint256 id = _gap(100);
        AmenMarket.Market memory m = market.getMarket(id);
        assertEq(uint8(m.kind), uint8(AmenMarket.Kind.GAP_CLOSE_TO_OPEN));
        assertEq(m.closeMarkPrice, NVDA_PX_18);
        assertEq(m.resolveEarliestTs, monOpen);
        assertEq(m.endTs, monOpen);
        assertEq(m.takerFeeBps, 100);
    }

    function test_RevertWhen_CreateWithoutRecordedClose() public {
        vm.prank(keeper);
        vm.expectRevert(
            abi.encodeWithSelector(Errors.CloseNotRecorded.selector, address(nvda), day(2026, 9, 24))
        );
        market.createGapMarket(address(nvda), day(2026, 9, 24), 100, 0, 1e6);
    }

    function test_RevertWhen_CreateNotKeeper() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Errors.NotKeeper.selector, alice));
        market.createGapMarket(address(nvda), fri, 100, 0, 1e6);
    }

    function test_RevertWhen_StockNotAllowed() public {
        vm.prank(owner);
        market.setStockAllowed(address(nvda), false);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(Errors.StockNotAllowed.selector, address(nvda)));
        market.createGapMarket(address(nvda), fri, 100, 0, 1e6);
    }

    // ───────────── gap outcomes ─────────────

    function test_GapYesWins() public {
        uint256 id = _gap(100);
        _buy(alice, id, true, 100e6);
        _buy(bob, id, false, 300e6);
        _openPrint(182_00000000, 0); // +1.11%
        market.resolve(id);

        AmenMarket.Market memory m = market.getMarket(id);
        assertTrue(m.resolved);
        assertTrue(m.yesWins);
        assertEq(m.resolvePrice, 182e18);
        assertEq(m.moveBps, 111);

        vm.prank(alice);
        assertEq(market.claim(id), 396e6); // 400 * 0.99
        vm.prank(bob);
        vm.expectRevert(Errors.NothingToClaim.selector);
        market.claim(id);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Errors.AlreadyClaimed.selector, id, alice));
        market.claim(id);

        market.claimFees();
        assertEq(usdg.balanceOf(feeRecipient), 4e6);
        assertEq(usdg.balanceOf(address(market)), 0);
    }

    function test_GapNoWins() public {
        uint256 id = _gap(100);
        _buy(alice, id, true, 100e6);
        _buy(bob, id, false, 300e6);
        _openPrint(181_00000000, 0); // +0.55%
        market.resolve(id);
        assertFalse(market.getMarket(id).yesWins);
        vm.prank(bob);
        assertEq(market.claim(id), 396e6);
    }

    function test_GapIsAbsolute_DownMoveYes() public {
        uint256 id = _gap(100);
        _buy(alice, id, true, 100e6);
        _buy(bob, id, false, 100e6);
        _openPrint(178_00000000, 1); // −1.11%
        market.resolve(id);
        assertTrue(market.getMarket(id).yesWins);
    }

    function test_GapExactStrikeIsYes() public {
        uint256 id = _gap(100);
        _buy(alice, id, true, 100e6);
        _buy(bob, id, false, 100e6);
        _openPrint(181_80000000, 0); // exactly +1.00%
        market.resolve(id);
        assertTrue(market.getMarket(id).yesWins);
    }

    function test_ResolveUsesFirstRoundAfterOpen() public {
        uint256 id = _gap(100);
        _buy(alice, id, true, 100e6);
        _buy(bob, id, false, 100e6);
        vm.warp(utc(2026, 9, 28, 13, 20));
        tick(190_00000000); // pre-market print: must be ignored
        vm.warp(monOpen + 1 minutes);
        uint80 first = tick(180_50000000); // first cash print: NO
        vm.warp(monOpen + 10 minutes);
        uint80 later = tick(185_00000000); // later print would be YES
        vm.warp(monOpen + 15 minutes);

        vm.expectRevert(abi.encodeWithSelector(Errors.ResolveRoundInvalid.selector, later));
        market.resolveWithRound(id, later);

        market.resolve(id);
        AmenMarket.Market memory m = market.getMarket(id);
        assertEq(m.resolveRoundId, first);
        assertFalse(m.yesWins);
    }

    function test_RevertWhen_ResolveTooEarly() public {
        uint256 id = _gap(100);
        _buy(alice, id, true, 1e6);
        vm.warp(monOpen - 1);
        vm.expectRevert(abi.encodeWithSelector(Errors.TooEarly.selector, monOpen - 1, monOpen));
        market.resolveWithRound(id, 1);
    }

    function test_VoidOnStaleFeed() public {
        uint256 id = _gap(100);
        _buy(alice, id, true, 100e6);
        _buy(bob, id, false, 300e6);
        // Monday: feed never prints after the open; Friday mark is stale -> frozen
        vm.warp(monOpen + 10 minutes);
        vm.expectRevert(abi.encodeWithSelector(Errors.OracleFrozen.selector, R_STALE));
        market.resolve(id);

        vm.expectRevert(abi.encodeWithSelector(Errors.VoidNotYetAllowed.selector, id));
        market.voidMarket(id);

        vm.warp(monOpen + 61 minutes);
        vm.expectRevert(abi.encodeWithSelector(Errors.ResolveWindowOver.selector, id));
        market.resolve(id);
        market.voidMarket(id);
        assertTrue(market.getMarket(id).voided);

        vm.prank(alice);
        assertEq(market.claim(id), 100e6);
        vm.prank(bob);
        assertEq(market.claim(id), 300e6);
        assertEq(market.accruedFees(), 0);
    }

    function test_VoidWhenPausedAtOpen() public {
        uint256 id = _gap(100);
        _buy(alice, id, true, 100e6);
        _buy(bob, id, false, 100e6);
        _openPrint(185_00000000, 0);
        nvda.setOraclePaused(true);
        vm.expectRevert(abi.encodeWithSelector(Errors.OracleFrozen.selector, R_PAUSED));
        market.resolve(id);
        vm.warp(monOpen + 2 hours);
        market.voidMarket(id);
        vm.prank(alice);
        assertEq(market.claim(id), 100e6);
    }

    function test_RevertWhen_ResolveOnHolidayOpen() public {
        uint256 id = _gap(100);
        _buy(alice, id, true, 1e6);
        _buy(bob, id, false, 1e6);
        vm.prank(owner);
        oracle.setHoliday(day(2026, 9, 28), true); // Monday becomes a holiday
        _openPrint(185_00000000, 0);
        vm.expectRevert(abi.encodeWithSelector(Errors.CashClosed.selector));
        market.resolve(id);
    }

    function test_OneSidedVoidsAtResolve() public {
        uint256 id = _gap(100);
        _buy(alice, id, true, 50e6);
        _openPrint(185_00000000, 0);
        market.resolve(id);
        AmenMarket.Market memory m = market.getMarket(id);
        assertTrue(m.voided);
        assertEq(m.resolveReason, market.REASON_ONE_SIDED());
        vm.prank(alice);
        assertEq(market.claim(id), 50e6);
    }

    // ───────────── multiple tickers ─────────────

    function test_TwoTickersSettleIndependently() public {
        MockStockToken aapl = new MockStockToken("Apple Stock Token", "AAPL");
        MockAggregator aaplFeed = new MockAggregator(8, "AAPL / USD");
        vm.startPrank(owner);
        oracle.setFeed(address(aapl), address(aaplFeed));
        market.setStockAllowed(address(aapl), true);
        vm.stopPrank();
        // AAPL Friday close $230 (NVDA's $180 close was recorded in setUp)
        aaplFeed.pushRound(230_00000000, utc(2026, 9, 25, 19, 56));
        oracle.recordSessionClose(address(aapl));

        uint256 nv = _gap(100);
        vm.prank(keeper);
        uint256 ap = market.createGapMarket(address(aapl), fri, 100, 0, 100_000e6);
        _buy(alice, nv, true, 100e6);
        _buy(bob, nv, false, 100e6);
        _buy(alice, ap, true, 100e6);
        _buy(bob, ap, false, 100e6);

        vm.warp(monOpen + 1 minutes);
        tick(182_00000000); // NVDA +1.11% -> YES
        aaplFeed.setAnswer(230_50000000); // AAPL +0.22% -> NO
        vm.warp(monOpen + 5 minutes);
        market.resolve(nv);
        market.resolve(ap);

        assertTrue(market.getMarket(nv).yesWins);
        assertFalse(market.getMarket(ap).yesWins);
        assertEq(market.getMarket(ap).closeMarkPrice, 230e18);
        assertEq(market.getMarket(ap).stockToken, address(aapl));
        assertEq(oracle.allStocks().length, 2);
    }

    // ───────────── trading rules ─────────────

    function test_RevertWhen_BuyAfterEnd() public {
        uint256 id = _gap(100);
        vm.warp(monOpen);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Errors.TradingClosed.selector, id));
        market.buy(id, true, 1e6);
    }

    function test_RevertWhen_BuyOverMaxNotional() public {
        vm.prank(keeper);
        uint256 id = market.createGapMarket(address(nvda), fri, 100, 0, 150e6);
        _buy(alice, id, true, 100e6);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Errors.MaxNotionalExceeded.selector, id));
        market.buy(id, false, 51e6);
    }

    function test_RevertWhen_BuyWhilePaused() public {
        uint256 id = _gap(100);
        nvda.setOraclePaused(true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Errors.OracleFrozen.selector, R_PAUSED));
        market.buy(id, true, 1e6);
    }

    // ───────────── ABS_MOVE ─────────────

    function test_AbsMoveLiveReference() public {
        // Thursday 2026-10-01 11:00 NY, live mark $200
        vm.warp(utc(2026, 10, 1, 15, 0));
        tick(200_00000000);
        uint256 resolveAt = utc(2026, 10, 2, 19, 0); // Fri 15:00 NY
        vm.prank(keeper);
        uint256 id = market.createAbsMoveMarket(address(nvda), 250, 0, resolveAt, resolveAt, 10_000e6);
        _buy(alice, id, true, 10e6);
        _buy(bob, id, false, 30e6);
        vm.warp(resolveAt + 30);
        tick(195_00000000); // −2.5% exactly -> YES
        vm.warp(resolveAt + 2 minutes);
        market.resolve(id);
        assertTrue(market.getMarket(id).yesWins);
        vm.prank(alice);
        assertEq(market.claim(id), 39.6e6);
    }

    function test_RevertWhen_AbsMoveResolveOutsideCash() public {
        vm.warp(utc(2026, 10, 1, 15, 0));
        tick(200_00000000);
        vm.prank(keeper);
        vm.expectRevert(Errors.InvalidParam.selector);
        market.createAbsMoveMarket(
            address(nvda), 100, 0, utc(2026, 10, 2, 22, 0), utc(2026, 10, 2, 22, 0), 1e6
        );
    }

    function test_RevertWhen_AbsMoveLiveRefDuringVespers() public {
        vm.prank(keeper);
        vm.expectRevert(Errors.CashClosed.selector);
        market.createAbsMoveMarket(address(nvda), 100, 0, monOpen, monOpen, 1e6);
    }

    // ───────────── reentrancy ─────────────

    function test_ReentrancyOnClaimBlocked() public {
        ReentrantUSDG evil = new ReentrantUSDG();
        AmenMarket m2 = new AmenMarket(owner, address(evil), address(oracle), feeRecipient);
        vm.startPrank(owner);
        m2.setStockAllowed(address(nvda), true);
        uint256 id = m2.createGapMarket(address(nvda), fri, 100, 0, 1_000e6);
        vm.stopPrank();
        evil.mint(alice, 100e6);
        evil.mint(bob, 100e6);
        vm.prank(alice);
        evil.approve(address(m2), type(uint256).max);
        vm.prank(bob);
        evil.approve(address(m2), type(uint256).max);
        vm.prank(alice);
        m2.buy(id, true, 100e6);
        vm.prank(bob);
        m2.buy(id, false, 100e6);
        _openPrint(185_00000000, 0);
        m2.resolve(id);
        evil.arm(address(m2), abi.encodeCall(AmenMarket.claim, (id)));
        vm.prank(alice);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        m2.claim(id);
    }

    // ───────────── parimutuel math (fuzz) ─────────────

    function testFuzz_ParimutuelClaimMath(
        uint256 a,
        uint256 b,
        uint256 c,
        bool aYes,
        bool bYes,
        bool yesWinsPx
    ) public {
        a = bound(a, 1, 5_000e6);
        b = bound(b, 1, 5_000e6);
        c = bound(c, 1, 5_000e6);
        uint256 id = _gap(100);
        _buy(alice, id, aYes, a);
        _buy(bob, id, bYes, b);
        _buy(carol, id, !aYes, c); // guarantees both sides non-empty
        uint256 total = a + b + c;
        _openPrint(yesWinsPx ? int256(185_00000000) : int256(180_10000000), 0);
        market.resolve(id);
        AmenMarket.Market memory m = market.getMarket(id);
        assertEq(m.yesWins, yesWinsPx);

        uint256 winningPool = yesWinsPx ? m.yesPool : m.noPool;
        uint256 fee = total * 100 / 10_000;
        uint256 paid;
        address[3] memory us = [alice, bob, carol];
        for (uint256 i; i < 3; ++i) {
            uint256 expected = market.claimable(id, us[i]);
            AmenMarket.Position memory p = market.positionOf(id, us[i]);
            uint256 stake = yesWinsPx ? p.yes : p.no;
            assertEq(expected, stake * (total - fee) / winningPool, "formula");
            if (expected > 0) {
                vm.prank(us[i]);
                paid += market.claim(id);
            }
        }
        assertEq(market.accruedFees(), fee);
        assertLe(paid + fee, total, "solvent");
        assertLe(total - fee - paid, 3, "dust bounded by #winners");
        if (fee > 0) market.claimFees();
        assertEq(usdg.balanceOf(address(market)), total - fee - paid);
    }

    function testFuzz_VoidRefundsExact(uint256 a, uint256 b) public {
        a = bound(a, 1, 5_000e6);
        b = bound(b, 1, 5_000e6);
        uint256 id = _gap(100);
        _buy(alice, id, true, a);
        _buy(bob, id, false, b);
        vm.warp(monOpen + 2 hours);
        market.voidMarket(id);
        vm.prank(alice);
        assertEq(market.claim(id), a);
        vm.prank(bob);
        assertEq(market.claim(id), b);
        assertEq(usdg.balanceOf(address(market)), 0);
    }
}
