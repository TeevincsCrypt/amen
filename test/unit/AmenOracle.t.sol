// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AmenTestBase} from "../utils/AmenTestBase.sol";
import {AmenOracle} from "../../src/AmenOracle.sol";
import {IAmenOracle} from "../../src/interfaces/IAmenOracle.sol";
import {SessionLib} from "../../src/libraries/SessionLib.sol";
import {Errors} from "../../src/libraries/Errors.sol";
import {MockStockTokenNoPause} from "../../src/mocks/MockStockToken.sol";
import {MockAggregator} from "../../src/mocks/MockAggregator.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract SessionLibHarness {
    function isUsDst(uint256 ts) external pure returns (bool) {
        return SessionLib.isUsDst(ts);
    }

    function yearOf(uint256 d) external pure returns (uint256) {
        return SessionLib.yearOf(d);
    }
}

contract AmenOracleTest is AmenTestBase {
    SessionLibHarness lib = new SessionLibHarness();

    // ───────────── chain id guard ─────────────

    function test_ChainIdGuard_RevertsOffRobinhood() public {
        vm.chainId(1);
        vm.expectRevert(abi.encodeWithSelector(Errors.WrongChain.selector, uint256(1)));
        new AmenOracle(owner);
        vm.chainId(31337);
        vm.expectRevert(abi.encodeWithSelector(Errors.WrongChain.selector, uint256(31337)));
        new AmenOracle(owner);
    }

    function test_ChainIdGuard_AllowsMainnetAndTestnet() public {
        vm.chainId(4663);
        new AmenOracle(owner);
        vm.chainId(46630);
        new AmenOracle(owner);
    }

    // ───────────── calendar ─────────────

    function test_Calendar_YearAndDst2026() public view {
        assertEq(lib.yearOf(day(2026, 9, 24)), 2026);
        assertEq(lib.yearOf(day(2024, 2, 29)), 2024);
        assertEq(lib.yearOf(day(2027, 1, 1)), 2027);
        // 2026: DST from Sun Mar 8 07:00 UTC to Sun Nov 1 06:00 UTC
        assertFalse(lib.isUsDst(utc(2026, 3, 8, 6, 59)));
        assertTrue(lib.isUsDst(utc(2026, 3, 8, 7, 0)));
        assertTrue(lib.isUsDst(utc(2026, 11, 1, 5, 59)));
        assertFalse(lib.isUsDst(utc(2026, 11, 1, 6, 0)));
        // 2025: Mar 9 / Nov 2
        assertTrue(lib.isUsDst(utc(2025, 3, 9, 7, 0)));
        assertFalse(lib.isUsDst(utc(2025, 11, 2, 6, 0)));
    }

    function test_Session_SummerEdt() public {
        // Thu 2026-09-24, EDT: 13:30–20:00 UTC
        vm.warp(utc(2026, 9, 24, 13, 29));
        assertFalse(oracle.isCashOpen());
        assertTrue(oracle.isVespers());
        vm.warp(utc(2026, 9, 24, 13, 30));
        assertTrue(oracle.isCashOpen());
        assertFalse(oracle.isVespers());
        vm.warp(utc(2026, 9, 24, 20, 0) - 1);
        assertTrue(oracle.isCashOpen());
        vm.warp(utc(2026, 9, 24, 20, 0));
        assertFalse(oracle.isCashOpen());
    }

    function test_Session_WinterEst() public {
        // Thu 2026-01-15, EST: 14:30–21:00 UTC
        vm.warp(utc(2026, 1, 15, 14, 29));
        assertFalse(oracle.isCashOpen());
        vm.warp(utc(2026, 1, 15, 14, 30));
        assertTrue(oracle.isCashOpen());
        vm.warp(utc(2026, 1, 15, 20, 30));
        assertTrue(oracle.isCashOpen());
        vm.warp(utc(2026, 1, 15, 21, 0));
        assertFalse(oracle.isCashOpen());
    }

    function test_Session_WeekendClosed() public {
        vm.warp(utc(2026, 9, 26, 15, 0)); // Saturday
        assertFalse(oracle.isCashOpen());
        assertTrue(oracle.isVespers());
        vm.warp(utc(2026, 9, 27, 15, 0)); // Sunday
        assertFalse(oracle.isCashOpen());
    }

    function test_Session_WeekendCloseAndNextOpen() public {
        vm.warp(utc(2026, 9, 26, 12, 0)); // Saturday
        (uint256 sid, uint256 closeTs) = oracle.lastCloseAt(block.timestamp);
        assertEq(sid, day(2026, 9, 25)); // Friday
        assertEq(closeTs, utc(2026, 9, 25, 20, 0));
        assertEq(oracle.nextOpenAfter(closeTs), utc(2026, 9, 28, 13, 30)); // Monday
    }

    function test_DstForceMode() public {
        vm.warp(utc(2026, 9, 24, 14, 0)); // EDT open
        assertTrue(oracle.isCashOpen());
        vm.prank(owner);
        oracle.setDstMode(SessionLib.DstMode.FORCE_EST); // pretend EST: opens 14:30 UTC
        assertFalse(oracle.isCashOpen());
        vm.warp(utc(2026, 9, 24, 20, 30));
        assertTrue(oracle.isCashOpen());
    }

    function test_HolidayOwnerOverride() public {
        vm.warp(utc(2026, 11, 26, 16, 0)); // Thanksgiving, would otherwise be open
        assertTrue(oracle.isCashOpen());
        vm.prank(owner);
        oracle.setHoliday(day(2026, 11, 26), true);
        assertFalse(oracle.isCashOpen());
        assertTrue(oracle.isVespers());
        assertTrue(oracle.isHoliday(day(2026, 11, 26)));
        // Last close skips the holiday; next open skips it too
        (uint256 sid,) = oracle.lastCloseAt(block.timestamp);
        assertEq(sid, day(2026, 11, 25));
        assertEq(oracle.nextOpenAfter(block.timestamp), utc(2026, 11, 27, 14, 30));
        vm.prank(owner);
        oracle.setHoliday(day(2026, 11, 26), false);
        assertTrue(oracle.isCashOpen());
    }

    function test_Holiday_OnlyKeeperOrOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Errors.NotKeeper.selector, alice));
        oracle.setHoliday(day(2026, 12, 25), true);
        vm.prank(keeper);
        oracle.setHoliday(day(2026, 12, 25), true);
        assertTrue(oracle.isHoliday(day(2026, 12, 25)));
    }

    function test_AdminOnlyOwner() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        oracle.setManualFreeze(true);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        oracle.setFeed(address(nvda), address(feed));
        vm.stopPrank();
    }

    // ───────────── marks ─────────────

    function test_Mark_NormalizesFeedDecimals() public {
        vm.warp(utc(2026, 9, 24, 14, 0));
        tick(NVDA_PX_8);
        IAmenOracle.Mark memory m = oracle.getMark(address(nvda));
        assertEq(m.priceUsd, NVDA_PX_18);
        assertTrue(m.cashOpen);
        assertFalse(m.frozen);

        MockAggregator feed18 = new MockAggregator(18, "18dec");
        vm.prank(owner);
        oracle.setFeed(address(nvda), address(feed18));
        feed18.setAnswer(123.45e18);
        assertEq(oracle.getMark(address(nvda)).priceUsd, 123.45e18);
    }

    function test_Mark_UiMultiplierIgnored() public {
        vm.warp(utc(2026, 9, 24, 14, 0));
        tick(NVDA_PX_8);
        nvda.setUIMultiplier(2e18); // 2:1 corporate action
        assertEq(oracle.getMark(address(nvda)).priceUsd, NVDA_PX_18);
    }

    function test_Mark_StaleDuringCashOpenFreezes() public {
        vm.warp(utc(2026, 9, 24, 14, 0));
        tick(NVDA_PX_8);
        vm.warp(block.timestamp + 30 minutes);
        assertFalse(oracle.getMark(address(nvda)).frozen);
        vm.warp(block.timestamp + 1);
        IAmenOracle.Mark memory m = oracle.getMark(address(nvda));
        assertTrue(m.frozen);
        assertEq(m.freezeReason, R_STALE);
    }

    function test_Mark_StaleDuringVespersNotFrozen() public {
        vm.warp(utc(2026, 9, 25, 19, 59)); // Friday just before close
        tick(NVDA_PX_8);
        vm.warp(utc(2026, 9, 27, 12, 0)); // Sunday: feed 40h stale
        IAmenOracle.Mark memory m = oracle.getMark(address(nvda));
        assertFalse(m.cashOpen);
        assertFalse(m.frozen);
        assertEq(m.priceUsd, NVDA_PX_18);
        // Monday open: stale weekend feed now freezes
        vm.warp(utc(2026, 9, 28, 13, 30));
        m = oracle.getMark(address(nvda));
        assertTrue(m.frozen);
        assertEq(m.freezeReason, R_STALE);
    }

    function test_Mark_PausedFreezes() public {
        tick(NVDA_PX_8);
        nvda.setOraclePaused(true);
        IAmenOracle.Mark memory m = oracle.getMark(address(nvda));
        assertTrue(m.frozen);
        assertEq(m.freezeReason, R_PAUSED);
    }

    function test_Mark_TokenWithoutPauseSelector() public {
        MockStockTokenNoPause np = new MockStockTokenNoPause();
        vm.prank(owner);
        oracle.setFeed(address(np), address(feed));
        tick(NVDA_PX_8);
        assertFalse(oracle.isStockPaused(address(np)));
        assertFalse(oracle.getMark(address(np)).frozen);
    }

    function test_Mark_NonPositiveFreezes() public {
        tick(0);
        IAmenOracle.Mark memory m = oracle.getMark(address(nvda));
        assertTrue(m.frozen);
        assertEq(m.freezeReason, R_NONPOSITIVE);
        assertEq(m.priceUsd, 0);
        tick(-1);
        assertEq(oracle.getMark(address(nvda)).freezeReason, R_NONPOSITIVE);
    }

    function test_Mark_FeedRevertFreezes() public {
        tick(NVDA_PX_8);
        feed.setShouldRevert(true);
        IAmenOracle.Mark memory m = oracle.getMark(address(nvda));
        assertTrue(m.frozen);
        assertEq(m.freezeReason, R_FEED_ERROR);
    }

    function test_Mark_ManualFreezeHasPriority() public {
        tick(NVDA_PX_8);
        nvda.setOraclePaused(true);
        vm.prank(owner);
        oracle.setManualFreeze(true);
        IAmenOracle.Mark memory m = oracle.getMark(address(nvda));
        assertEq(m.freezeReason, R_MANUAL);
        assertFalse(oracle.isVespers());
    }

    function test_Mark_UnknownStockReverts() public {
        vm.expectRevert(abi.encodeWithSelector(Errors.UnknownStock.selector, alice));
        oracle.getMark(alice);
    }

    // ───────────── official closes ─────────────

    function test_RecordClose_Permissionless() public {
        tickAt(NVDA_PX_8, utc(2026, 9, 25, 19, 55)); // Fri 15:55 NY
        vm.warp(utc(2026, 9, 25, 20, 5));
        vm.prank(alice);
        oracle.recordSessionClose(address(nvda));
        IAmenOracle.Mark memory m = oracle.officialClose(address(nvda), day(2026, 9, 25));
        assertEq(m.priceUsd, NVDA_PX_18);
        assertEq(m.updatedAt, utc(2026, 9, 25, 19, 55));
        assertEq(oracle.lastRecordedSession(address(nvda)), day(2026, 9, 25));

        vm.expectRevert(abi.encodeWithSelector(Errors.AlreadyRecorded.selector, address(nvda), day(2026, 9, 25)));
        oracle.recordSessionClose(address(nvda));
    }

    function test_RecordClose_RevertsWhileCashOpen() public {
        vm.warp(utc(2026, 9, 25, 15, 0));
        tick(NVDA_PX_8);
        vm.expectRevert(Errors.CashOpen.selector);
        oracle.recordSessionClose(address(nvda));
    }

    function test_RecordClose_RejectsAfterHoursRound() public {
        tickAt(NVDA_PX_8, utc(2026, 9, 25, 19, 55));
        tickAt(185_00000000, utc(2026, 9, 25, 20, 30)); // after-hours drift
        vm.warp(utc(2026, 9, 25, 21, 0));
        vm.expectRevert(
            abi.encodeWithSelector(
                Errors.RoundOutsideCloseWindow.selector, uint80(2), utc(2026, 9, 25, 20, 30), utc(2026, 9, 25, 20, 0)
            )
        );
        oracle.recordSessionClose(address(nvda));
        // ...but the at-round path picks the last round before the bell
        oracle.recordSessionCloseAtRound(address(nvda), 1);
        assertEq(oracle.officialClose(address(nvda), day(2026, 9, 25)).priceUsd, NVDA_PX_18);
    }

    function test_RecordCloseAtRound_RejectsNonLastRound() public {
        tickAt(179_00000000, utc(2026, 9, 25, 19, 50));
        tickAt(NVDA_PX_8, utc(2026, 9, 25, 19, 58));
        vm.warp(utc(2026, 9, 25, 20, 10));
        vm.expectRevert(abi.encodeWithSelector(Errors.RoundNotLastBeforeClose.selector, uint80(1)));
        oracle.recordSessionCloseAtRound(address(nvda), 1);
    }

    function test_RecordClose_RejectsTooOldRound() public {
        tickAt(NVDA_PX_8, utc(2026, 9, 25, 19, 0)); // 60 min before close
        vm.warp(utc(2026, 9, 25, 20, 10));
        vm.expectRevert();
        oracle.recordSessionClose(address(nvda));
        // keeper can force with the same (pre-bell) Chainlink round
        vm.prank(keeper);
        oracle.forceRecordSessionClose(address(nvda), day(2026, 9, 25), 1);
        assertEq(oracle.officialClose(address(nvda), day(2026, 9, 25)).priceUsd, NVDA_PX_18);
    }

    function test_RecordClose_PausedReverts() public {
        tickAt(NVDA_PX_8, utc(2026, 9, 25, 19, 55));
        vm.warp(utc(2026, 9, 25, 20, 5));
        nvda.setOraclePaused(true);
        vm.expectRevert(abi.encodeWithSelector(Errors.OracleFrozen.selector, R_PAUSED));
        oracle.recordSessionClose(address(nvda));
    }

    function test_ForceRecord_OnlyKeeper() public {
        tickAt(NVDA_PX_8, utc(2026, 9, 25, 19, 55));
        vm.warp(utc(2026, 9, 25, 20, 5));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Errors.NotKeeper.selector, alice));
        oracle.forceRecordSessionClose(address(nvda), day(2026, 9, 25), 1);
    }

    function test_OfficialClose_UnrecordedReverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(Errors.CloseNotRecorded.selector, address(nvda), day(2026, 9, 25))
        );
        oracle.officialClose(address(nvda), day(2026, 9, 25));
    }
}
