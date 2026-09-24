// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAmenOracle} from "./interfaces/IAmenOracle.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";
import {IStockToken} from "./interfaces/IStockToken.sol";
import {AmenAccess} from "./base/AmenAccess.sol";
import {NetworkGuard} from "./libraries/NetworkGuard.sol";
import {SessionLib} from "./libraries/SessionLib.sol";
import {DecimalLib} from "./libraries/DecimalLib.sol";
import {Errors} from "./libraries/Errors.sol";

/// @title AmenOracle
/// @notice Session clock (US cash hours, DST, holidays) plus Chainlink Stock Token feed guards.
///         Every Amen contract reads prices and session state only through this contract's `Mark`.
/// @dev Chainlink equity feeds update about 24/5 with US market hours, so a stale weekend feed is
///      normal. Staleness freezes a mark only while cash is open. A stale Vespers mark is still
///      exposed (not frozen) but must never be used to settle an event: AmenMarket settles only on
///      rounds published during a cash session.
contract AmenOracle is IAmenOracle, AmenAccess, NetworkGuard {
    bytes32 public constant STALE = "STALE";
    bytes32 public constant PAUSED = "PAUSED";
    bytes32 public constant NONPOSITIVE = "NONPOSITIVE";
    bytes32 public constant HOLIDAY_OVERRIDE = "HOLIDAY_OVERRIDE";
    bytes32 public constant MANUAL = "MANUAL";
    bytes32 public constant FEED_ERROR = "FEED_ERROR";

    /// @notice Max feed age while cash is open before the mark freezes.
    uint256 public constant MAX_STALENESS_OPEN = 30 minutes;
    /// @notice A permissionless close record must use a round published within this long before the bell.
    uint256 public constant CLOSE_LOOKBACK = 30 minutes;
    /// @notice Calendar search horizon; covers any realistic run of weekends + holidays.
    uint256 internal constant MAX_CALENDAR_SCAN = 14;

    mapping(address stockToken => address feed) public feedOf;
    mapping(address stockToken => uint8 decimals) public feedDecimals;
    mapping(uint256 word => uint256 bits) internal _holidayBitmap;
    mapping(address stockToken => mapping(uint256 sessionId => Mark)) internal _officialClose;
    mapping(address stockToken => uint256 sessionId) public lastRecordedSession;

    SessionLib.DstMode public dstMode;
    bool public manualFreeze;

    event FeedSet(address indexed stockToken, address indexed feed, uint8 decimals);
    event HolidaySet(uint256 indexed day, bool closed, bytes32 reason);
    event DstModeSet(SessionLib.DstMode mode);
    event ManualFreezeSet(bool frozen);
    event SessionCloseRecorded(
        address indexed stockToken,
        uint256 indexed sessionId,
        uint256 priceUsd,
        uint256 updatedAt,
        uint80 roundId,
        address recorder,
        bool forced
    );

    /// @param owner_ Protocol owner (Ownable2Step).
    constructor(address owner_) AmenAccess(owner_) {}

    // ───────────────────────────── admin ─────────────────────────────

    /// @notice Registers or replaces the Chainlink feed for a Stock Token. `decimals()` is read live.
    /// @param stockToken Stock Token address.
    /// @param feed Chainlink AggregatorV3 feed (USD per raw token).
    function setFeed(address stockToken, address feed) external onlyOwner {
        if (stockToken == address(0) || feed == address(0)) revert Errors.ZeroAddress();
        uint8 dec = IAggregatorV3(feed).decimals();
        if (dec > 36) revert Errors.InvalidParam();
        feedOf[stockToken] = feed;
        feedDecimals[stockToken] = dec;
        emit FeedSet(stockToken, feed, dec);
    }

    /// @notice Marks a NY trading date as a full-day market holiday (cash closed all day) or clears it.
    /// @param day UTC day index (`timestamp / 86400`), which equals the NY date during session hours.
    /// @param closed True to mark as holiday.
    function setHoliday(uint256 day, bool closed) external onlyKeeperOrOwner {
        (uint256 word, uint256 mask) = SessionLib.holidaySlot(day);
        if (closed) _holidayBitmap[word] |= mask;
        else _holidayBitmap[word] &= ~mask;
        emit HolidaySet(day, closed, HOLIDAY_OVERRIDE);
    }

    /// @notice Overrides automatic US DST detection (the brief's owner-settable `dstFlag`).
    /// @param mode AUTO (2007+ US rule), FORCE_EDT (UTC-4) or FORCE_EST (UTC-5).
    function setDstMode(SessionLib.DstMode mode) external onlyOwner {
        dstMode = mode;
        emit DstModeSet(mode);
    }

    /// @notice Emergency freeze of every mark. Vault swaps, market trading and resolution stop.
    /// @param frozen True to freeze.
    function setManualFreeze(bool frozen) external onlyOwner {
        manualFreeze = frozen;
        emit ManualFreezeSet(frozen);
    }

    // ───────────────────────────── session ─────────────────────────────

    /// @notice True if `day` has been marked as a holiday.
    function isHoliday(uint256 day) public view returns (bool) {
        (uint256 word, uint256 mask) = SessionLib.holidaySlot(day);
        return _holidayBitmap[word] & mask != 0;
    }

    /// @notice True if `day` is a weekday and not a holiday.
    function isTradingDay(uint256 day) public view returns (bool) {
        return SessionLib.isWeekday(day) && !isHoliday(day);
    }

    /// @notice Regular-session open/close timestamps for NY trading date `day` (ignores holidays).
    function sessionTimes(uint256 day) public view returns (uint256 openTs, uint256 closeTs) {
        return SessionLib.sessionTimes(day, dstMode);
    }

    /// @inheritdoc IAmenOracle
    function isCashOpenAt(uint256 ts) public view returns (bool) {
        uint256 day = SessionLib.dayIndex(ts);
        if (!isTradingDay(day)) return false;
        (uint256 o, uint256 c) = sessionTimes(day);
        return ts >= o && ts < c;
    }

    /// @inheritdoc IAmenOracle
    function isCashOpen() public view returns (bool) {
        return isCashOpenAt(block.timestamp);
    }

    /// @inheritdoc IAmenOracle
    /// @dev Global session state. A per-stock freeze (PAUSED/NONPOSITIVE) is reported by `getMark`.
    function isVespers() public view returns (bool) {
        return !isCashOpen() && !manualFreeze;
    }

    /// @notice Most recent regular-session close at or before `ts`.
    /// @return sessionId Trading date (UTC day index) of that close.
    /// @return closeTs Close timestamp.
    function lastCloseAt(uint256 ts) public view returns (uint256 sessionId, uint256 closeTs) {
        uint256 today = SessionLib.dayIndex(ts);
        for (uint256 i; i <= MAX_CALENDAR_SCAN && i <= today; ++i) {
            uint256 d = today - i;
            if (!isTradingDay(d)) continue;
            (, uint256 c) = sessionTimes(d);
            if (c <= ts) return (d, c);
        }
        revert Errors.NoRecentClose();
    }

    /// @inheritdoc IAmenOracle
    function nextOpenAfter(uint256 ts) public view returns (uint256) {
        uint256 today = SessionLib.dayIndex(ts);
        for (uint256 i; i <= MAX_CALENDAR_SCAN; ++i) {
            uint256 d = today + i;
            if (!isTradingDay(d)) continue;
            (uint256 o,) = sessionTimes(d);
            if (o > ts) return o;
        }
        revert Errors.NoRecentClose();
    }

    /// @notice First regular-session close strictly after `ts`.
    function nextCloseAfter(uint256 ts) public view returns (uint256) {
        uint256 today = SessionLib.dayIndex(ts);
        for (uint256 i; i <= MAX_CALENDAR_SCAN; ++i) {
            uint256 d = today + i;
            if (!isTradingDay(d)) continue;
            (, uint256 c) = sessionTimes(d);
            if (c > ts) return c;
        }
        revert Errors.NoRecentClose();
    }

    /// @inheritdoc IAmenOracle
    function sessionCloseTs(uint256 sessionId) public view returns (uint256) {
        (, uint256 c) = sessionTimes(sessionId);
        return c;
    }

    /// @notice Snapshot for UIs: session flags plus the next open and close.
    function sessionState()
        external
        view
        returns (bool cashOpen, bool vespers, bool frozen, uint256 nextOpen, uint256 nextClose)
    {
        cashOpen = isCashOpen();
        vespers = isVespers();
        frozen = manualFreeze;
        nextOpen = nextOpenAfter(block.timestamp);
        nextClose = nextCloseAfter(block.timestamp);
    }

    // ───────────────────────────── marks ─────────────────────────────

    /// @inheritdoc IAmenOracle
    /// @dev Never reverts for a registered stock: bad data comes back as `frozen = true` with a reason,
    ///      so callers can make an explicit decision instead of bubbling an opaque revert.
    function getMark(address stockToken) public view returns (Mark memory m) {
        address feed = feedOf[stockToken];
        if (feed == address(0)) revert Errors.UnknownStock(stockToken);

        m.cashOpen = isCashOpen();

        int256 answer;
        bool feedOk;
        try IAggregatorV3(feed).latestRoundData() returns (
            uint80 rid, int256 a, uint256, uint256 upd, uint80
        ) {
            m.roundId = rid;
            m.updatedAt = upd;
            answer = a;
            feedOk = upd != 0 && upd <= block.timestamp;
        } catch {}

        if (feedOk && answer > 0) {
            // Chainlink Stock Token prices are total-return / multiplier-aware: never apply uiMultiplier.
            m.priceUsd = DecimalLib.toWad(uint256(answer), feedDecimals[stockToken]);
        }

        if (manualFreeze) {
            (m.frozen, m.freezeReason) = (true, MANUAL);
        } else if (!feedOk) {
            (m.frozen, m.freezeReason) = (true, FEED_ERROR);
        } else if (isStockPaused(stockToken)) {
            (m.frozen, m.freezeReason) = (true, PAUSED);
        } else if (answer <= 0) {
            (m.frozen, m.freezeReason) = (true, NONPOSITIVE);
        } else if (m.cashOpen && block.timestamp - m.updatedAt > MAX_STALENESS_OPEN) {
            // Only stale during the cash session is a failure; a stale Vespers feed is expected.
            (m.frozen, m.freezeReason) = (true, STALE);
        }
    }

    /// @inheritdoc IAmenOracle
    /// @dev Some Stock Tokens don't implement `oraclePaused()`. A missing selector or bad return
    ///      data counts as "not paused". A true return always freezes.
    function isStockPaused(address stockToken) public view returns (bool) {
        (bool ok, bytes memory ret) =
            stockToken.staticcall(abi.encodeWithSelector(IStockToken.oraclePaused.selector));
        if (!ok || ret.length < 32) return false;
        return abi.decode(ret, (uint256)) != 0;
    }

    /// @inheritdoc IAmenOracle
    function getRoundMark(address stockToken, uint80 roundId)
        public
        view
        returns (bool ok, uint256 priceUsd, uint256 updatedAt)
    {
        address feed = feedOf[stockToken];
        if (feed == address(0)) revert Errors.UnknownStock(stockToken);
        try IAggregatorV3(feed).getRoundData(roundId) returns (
            uint80, int256 a, uint256, uint256 upd, uint80
        ) {
            if (a > 0 && upd != 0 && upd <= block.timestamp) {
                return (true, DecimalLib.toWad(uint256(a), feedDecimals[stockToken]), upd);
            }
        } catch {}
        return (false, 0, 0);
    }

    /// @notice Latest Chainlink round id for a stock (0 if the feed reverts).
    function latestRoundId(address stockToken) external view returns (uint80 rid) {
        address feed = feedOf[stockToken];
        if (feed == address(0)) revert Errors.UnknownStock(stockToken);
        try IAggregatorV3(feed).latestRoundData() returns (uint80 r, int256, uint256, uint256, uint80) {
            rid = r;
        } catch {}
    }

    // ───────────────────────────── official closes ─────────────────────────────

    /// @inheritdoc IAmenOracle
    /// @dev Permissionless. Uses the latest round, which must have been published in
    ///      [close − 30 min, close]. After-hours rounds are rejected so the recorded value is the
    ///      closing mark, not overnight drift. If the feed already ticked after the bell,
    ///      use `recordSessionCloseAtRound`.
    function recordSessionClose(address stockToken) external {
        (uint256 sessionId, uint256 closeTs) = _mostRecentUnrecordedClose(stockToken);
        address feed = feedOf[stockToken];
        (uint80 rid, int256 answer,, uint256 upd,) = IAggregatorV3(feed).latestRoundData();
        _checkCloseWindow(rid, upd, closeTs, true);
        _storeClose(stockToken, sessionId, rid, answer, upd, false);
    }

    /// @notice Permissionless close record at a specific round, for when the feed has already
    ///         ticked after the bell. Proves `roundId` is the last round at or before the close.
    /// @param stockToken Stock Token.
    /// @param roundId Chainlink round id published in [close − 30 min, close] whose successor is after close.
    function recordSessionCloseAtRound(address stockToken, uint80 roundId) external {
        (uint256 sessionId, uint256 closeTs) = _mostRecentUnrecordedClose(stockToken);
        (int256 answer, uint256 upd) = _roundRaw(stockToken, roundId);
        _checkCloseWindow(roundId, upd, closeTs, true);
        _requireLastRoundBefore(stockToken, roundId, closeTs);
        _storeClose(stockToken, sessionId, roundId, answer, upd, false);
    }

    /// @notice Keeper/owner fallback for a missed or late close. The price is still read from
    ///         Chainlink (the owner can never type a price) and must predate the bell. The 30-min
    ///         lookback and the "most recent session" rules are relaxed.
    /// @param stockToken Stock Token.
    /// @param sessionId Trading date (UTC day index) whose close to record.
    /// @param roundId Chainlink round to use.
    function forceRecordSessionClose(address stockToken, uint256 sessionId, uint80 roundId)
        external
        onlyKeeperOrOwner
    {
        if (feedOf[stockToken] == address(0)) revert Errors.UnknownStock(stockToken);
        if (!isTradingDay(sessionId)) revert Errors.InvalidParam();
        uint256 closeTs = sessionCloseTs(sessionId);
        if (closeTs > block.timestamp) revert Errors.CashOpen();
        if (_officialClose[stockToken][sessionId].updatedAt != 0) {
            revert Errors.AlreadyRecorded(stockToken, sessionId);
        }
        (int256 answer, uint256 upd) = _roundRaw(stockToken, roundId);
        _checkCloseWindow(roundId, upd, closeTs, false);
        _requireLastRoundBefore(stockToken, roundId, closeTs);
        _storeClose(stockToken, sessionId, roundId, answer, upd, true);
    }

    /// @inheritdoc IAmenOracle
    function officialClose(address stockToken, uint256 sessionId) external view returns (Mark memory) {
        Mark memory m = _officialClose[stockToken][sessionId];
        if (m.updatedAt == 0) revert Errors.CloseNotRecorded(stockToken, sessionId);
        return m;
    }

    /// @notice True if an official close exists for (stock, session).
    function hasOfficialClose(address stockToken, uint256 sessionId) external view returns (bool) {
        return _officialClose[stockToken][sessionId].updatedAt != 0;
    }

    // ───────────────────────────── internals ─────────────────────────────

    function _mostRecentUnrecordedClose(address stockToken)
        internal
        view
        returns (uint256 sessionId, uint256 closeTs)
    {
        if (feedOf[stockToken] == address(0)) revert Errors.UnknownStock(stockToken);
        if (isCashOpen()) revert Errors.CashOpen();
        (sessionId, closeTs) = lastCloseAt(block.timestamp);
        if (_officialClose[stockToken][sessionId].updatedAt != 0) {
            revert Errors.AlreadyRecorded(stockToken, sessionId);
        }
    }

    function _roundRaw(address stockToken, uint80 roundId)
        internal
        view
        returns (int256 answer, uint256 upd)
    {
        try IAggregatorV3(feedOf[stockToken]).getRoundData(roundId) returns (
            uint80, int256 a, uint256, uint256 u, uint80
        ) {
            if (u == 0) revert Errors.BadRound(roundId);
            return (a, u);
        } catch {
            revert Errors.BadRound(roundId);
        }
    }

    function _checkCloseWindow(uint80 rid, uint256 upd, uint256 closeTs, bool enforceLookback) internal pure {
        if (upd > closeTs || (enforceLookback && upd + CLOSE_LOOKBACK < closeTs)) {
            revert Errors.RoundOutsideCloseWindow(rid, upd, closeTs);
        }
    }

    /// @dev Successor round must be missing (e.g. not yet published or a phase boundary) or after the close.
    function _requireLastRoundBefore(address stockToken, uint80 roundId, uint256 closeTs) internal view {
        try IAggregatorV3(feedOf[stockToken]).getRoundData(roundId + 1) returns (
            uint80, int256, uint256, uint256 nextUpd, uint80
        ) {
            if (nextUpd != 0 && nextUpd <= closeTs) revert Errors.RoundNotLastBeforeClose(roundId);
        } catch {}
    }

    function _storeClose(
        address stockToken,
        uint256 sessionId,
        uint80 rid,
        int256 answer,
        uint256 upd,
        bool forced
    ) internal {
        if (manualFreeze) revert Errors.OracleFrozen(MANUAL);
        if (isStockPaused(stockToken)) revert Errors.OracleFrozen(PAUSED);
        if (answer <= 0) revert Errors.OracleFrozen(NONPOSITIVE);
        uint256 price = DecimalLib.toWad(uint256(answer), feedDecimals[stockToken]);
        _officialClose[stockToken][sessionId] = Mark({
            priceUsd: price,
            updatedAt: upd,
            roundId: rid,
            cashOpen: false,
            frozen: false,
            freezeReason: bytes32(0)
        });
        if (sessionId > lastRecordedSession[stockToken]) lastRecordedSession[stockToken] = sessionId;
        emit SessionCloseRecorded(stockToken, sessionId, price, upd, rid, msg.sender, forced);
    }
}
