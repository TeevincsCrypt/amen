// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IAmenOracle} from "./interfaces/IAmenOracle.sol";
import {AmenAccess} from "./base/AmenAccess.sol";
import {NetworkGuard} from "./libraries/NetworkGuard.sol";
import {Errors} from "./libraries/Errors.sol";

/// @title AmenMarket
/// @notice Defined-risk parimutuel event books on Stock Tokens, collateralised in USDG (6 decimals).
///         Phase 1 kinds:
///         - GAP_CLOSE_TO_OPEN: YES if |open / officialClose − 1| >= strike (absolute gap).
///         - ABS_MOVE: YES if |mark_resolve / reference − 1| >= strike, measured AT the resolve mark.
/// @dev Settlement philosophy: prefer freeze-and-refund over a clever resolve.
///      - The resolve mark is the FIRST Chainlink round published at or after `resolveEarliestTs`,
///        proven by showing the previous round is earlier. It must also be published during the
///        cash session. The outcome therefore doesn't depend on when someone calls `resolve`,
///        and a stale weekend or pre-market print can never settle a market.
///      - Resolution needs the live mark to be unfrozen and cash to be open. If that isn't
///        achieved within RESOLVE_WINDOW (60 min) of `resolveEarliestTs`, anyone can void the
///        market and every stake is refunded 1:1 with no fee.
///      - Users trade with their own USDG; the Vespers vault does not underwrite these books in Phase 1.
contract AmenMarket is AmenAccess, ReentrancyGuard, NetworkGuard {
    using SafeERC20 for IERC20;

    enum Kind {
        GAP_CLOSE_TO_OPEN,
        ABS_MOVE
    }

    struct Market {
        uint256 id;
        Kind kind;
        address stockToken;
        uint256 strikeBps; // e.g. 100 = 1.00%
        uint256 closeMarkPrice; // 18-dec USD reference
        uint256 closeMarkTs;
        uint256 startTs;
        uint256 endTs;
        uint256 resolveEarliestTs;
        uint256 yesPool; // USDG-6
        uint256 noPool; // USDG-6
        bool resolved;
        bool yesWins;
        bool voided;
        bytes32 resolveReason;
        // extensions
        uint256 sessionId; // official close session (0 for live-mark ABS markets)
        uint256 maxNotional; // USDG-6 cap on yesPool + noPool
        uint256 takerFeeBps; // snapshotted at creation
        uint256 resolvePrice; // 18-dec USD
        uint256 resolveMarkTs; // updatedAt of the resolving round
        uint80 resolveRoundId;
        uint256 moveBps; // |move| in bps, rounded down (informational)
    }

    struct Position {
        uint256 yes;
        uint256 no;
        bool claimed;
    }

    uint256 public constant BPS = 10_000;
    uint256 public constant RESOLVE_WINDOW = 60 minutes;
    uint256 public constant MAX_ROUND_SCAN = 64;
    uint256 public constant MAX_TAKER_FEE_BPS = 500;

    bytes32 public constant REASON_RESOLVED = "RESOLVED";
    bytes32 public constant REASON_ONE_SIDED = "ONE_SIDED";
    bytes32 public constant REASON_TIMEOUT = "RESOLVE_TIMEOUT";

    IAmenOracle public immutable oracle;
    IERC20 public immutable usdg;

    address public feeRecipient;
    uint256 public takerFeeBps = 100; // 1%
    uint256 public maxNotionalLimit = 1_000_000e6; // hard ceiling a keeper may set per market
    uint256 public accruedFees;
    uint256 public marketCount;

    mapping(address stockToken => bool) public stockAllowed;
    mapping(uint256 id => Market) internal _markets;
    mapping(uint256 id => mapping(address user => Position)) internal _positions;

    event MarketCreated(
        uint256 indexed id,
        Kind kind,
        address indexed stockToken,
        uint256 strikeBps,
        uint256 closeMarkPrice,
        uint256 closeMarkTs,
        uint256 endTs,
        uint256 resolveEarliestTs,
        uint256 maxNotional
    );
    event Bought(uint256 indexed id, address indexed user, bool yes, uint256 amount);
    event Resolved(
        uint256 indexed id,
        uint256 closeMarkPrice,
        uint256 resolvePrice,
        uint256 moveBps,
        bool yesWins,
        uint80 roundId,
        uint256 fee
    );
    event Voided(uint256 indexed id, bytes32 reason);
    event Claimed(uint256 indexed id, address indexed user, uint256 amount);
    event FeesClaimed(address indexed to, uint256 amount);
    event StockAllowedSet(address indexed stockToken, bool allowed);
    event FeeParamsSet(address feeRecipient, uint256 takerFeeBps, uint256 maxNotionalLimit);

    /// @param owner_ Owner (Ownable2Step).
    /// @param usdg_ USDG collateral token, which must have 6 decimals.
    /// @param oracle_ AmenOracle.
    /// @param feeRecipient_ Taker fee recipient.
    constructor(address owner_, address usdg_, address oracle_, address feeRecipient_) AmenAccess(owner_) {
        if (usdg_ == address(0) || oracle_ == address(0) || feeRecipient_ == address(0)) {
            revert Errors.ZeroAddress();
        }
        if (IERC20Metadata(usdg_).decimals() != 6) revert Errors.InvalidParam();
        usdg = IERC20(usdg_);
        oracle = IAmenOracle(oracle_);
        feeRecipient = feeRecipient_;
    }

    // ───────────────────────────── creation ─────────────────────────────

    /// @notice Creates a gap market against a recorded official close. It resolves at the next cash open.
    /// @param stockToken Allow-listed Stock Token.
    /// @param sessionId Trading date (UTC day index) whose official close is the reference.
    /// @param strikeBps Absolute gap threshold in bps (1..10000).
    /// @param endTs Trading end; 0 = the next open. Must be <= next open.
    /// @param maxNotional Cap on total USDG staked (6 dec), <= maxNotionalLimit.
    /// @return id New market id.
    function createGapMarket(
        address stockToken,
        uint256 sessionId,
        uint256 strikeBps,
        uint256 endTs,
        uint256 maxNotional
    ) external onlyKeeperOrOwner returns (uint256 id) {
        IAmenOracle.Mark memory ref = oracle.officialClose(stockToken, sessionId);
        uint256 resolveEarliest = oracle.nextOpenAfter(oracle.sessionCloseTs(sessionId));
        if (endTs == 0) endTs = resolveEarliest;
        id = _create(
            Kind.GAP_CLOSE_TO_OPEN,
            stockToken,
            strikeBps,
            ref.priceUsd,
            ref.updatedAt,
            sessionId,
            endTs,
            resolveEarliest,
            maxNotional
        );
    }

    /// @notice Creates an absolute-move market measured at `resolveEarliestTs`.
    /// @param stockToken Allow-listed Stock Token.
    /// @param strikeBps Absolute move threshold in bps (1..10000).
    /// @param sessionId Official close reference; 0 = the current live mark (cash must be open and unfrozen).
    /// @param endTs Trading end, <= resolveEarliestTs.
    /// @param resolveEarliestTs Measurement time; must fall inside a cash session.
    /// @param maxNotional Cap on total USDG staked (6 dec).
    /// @return id New market id.
    function createAbsMoveMarket(
        address stockToken,
        uint256 strikeBps,
        uint256 sessionId,
        uint256 endTs,
        uint256 resolveEarliestTs,
        uint256 maxNotional
    ) external onlyKeeperOrOwner returns (uint256 id) {
        uint256 refPx;
        uint256 refTs;
        if (sessionId != 0) {
            IAmenOracle.Mark memory ref = oracle.officialClose(stockToken, sessionId);
            (refPx, refTs) = (ref.priceUsd, ref.updatedAt);
        } else {
            // A live reference is only trustworthy while cash is open and the feed is fresh.
            IAmenOracle.Mark memory m = oracle.getMark(stockToken);
            if (m.frozen) revert Errors.OracleFrozen(m.freezeReason);
            if (!m.cashOpen) revert Errors.CashClosed();
            (refPx, refTs) = (m.priceUsd, m.updatedAt);
        }
        if (!oracle.isCashOpenAt(resolveEarliestTs)) revert Errors.InvalidParam();
        id = _create(
            Kind.ABS_MOVE, stockToken, strikeBps, refPx, refTs, sessionId, endTs, resolveEarliestTs, maxNotional
        );
    }

    function _create(
        Kind kind,
        address stockToken,
        uint256 strikeBps,
        uint256 refPx,
        uint256 refTs,
        uint256 sessionId,
        uint256 endTs,
        uint256 resolveEarliest,
        uint256 maxNotional
    ) internal returns (uint256 id) {
        if (!stockAllowed[stockToken]) revert Errors.StockNotAllowed(stockToken);
        if (strikeBps == 0 || strikeBps > BPS) revert Errors.InvalidParam();
        if (refPx == 0) revert Errors.InvalidParam();
        if (maxNotional == 0 || maxNotional > maxNotionalLimit) revert Errors.InvalidParam();
        if (endTs <= block.timestamp || endTs > resolveEarliest) revert Errors.InvalidParam();

        id = ++marketCount;
        Market storage mk = _markets[id];
        mk.id = id;
        mk.kind = kind;
        mk.stockToken = stockToken;
        mk.strikeBps = strikeBps;
        mk.closeMarkPrice = refPx;
        mk.closeMarkTs = refTs;
        mk.startTs = block.timestamp;
        mk.endTs = endTs;
        mk.resolveEarliestTs = resolveEarliest;
        mk.sessionId = sessionId;
        mk.maxNotional = maxNotional;
        mk.takerFeeBps = takerFeeBps;

        emit MarketCreated(id, kind, stockToken, strikeBps, refPx, refTs, endTs, resolveEarliest, maxNotional);
    }

    // ───────────────────────────── trading ─────────────────────────────

    /// @notice Stakes USDG on YES or NO (parimutuel). No leverage; your max loss is the stake.
    /// @param id Market id.
    /// @param yes True for YES, false for NO.
    /// @param amount USDG amount (6 decimals).
    function buy(uint256 id, bool yes, uint256 amount) external nonReentrant {
        Market storage mk = _market(id);
        if (amount == 0) revert Errors.ZeroAmount();
        if (block.timestamp < mk.startTs || block.timestamp >= mk.endTs || mk.resolved || mk.voided) {
            revert Errors.TradingClosed(id);
        }
        // Frozen underlying (PAUSED/NONPOSITIVE/MANUAL, or STALE during cash) stops new risk.
        IAmenOracle.Mark memory m = oracle.getMark(mk.stockToken);
        if (m.frozen) revert Errors.OracleFrozen(m.freezeReason);
        if (mk.yesPool + mk.noPool + amount > mk.maxNotional) revert Errors.MaxNotionalExceeded(id);

        Position storage p = _positions[id][msg.sender];
        if (yes) {
            mk.yesPool += amount;
            p.yes += amount;
        } else {
            mk.noPool += amount;
            p.no += amount;
        }
        emit Bought(id, msg.sender, yes, amount);

        usdg.safeTransferFrom(msg.sender, address(this), amount);
    }

    // ───────────────────────────── settlement ─────────────────────────────

    /// @notice Permissionless resolve. Finds the first round at or after resolveEarliestTs by walking back from the latest round.
    /// @param id Market id.
    function resolve(uint256 id) external nonReentrant {
        Market storage mk = _market(id);
        _checkResolvable(id, mk);
        address stock = mk.stockToken;
        uint256 earliest = mk.resolveEarliestTs;
        uint80 rid = oracle.latestRoundId(stock);
        uint80 found;
        bool proven;
        for (uint256 i; i < MAX_ROUND_SCAN && rid != 0; ++i) {
            (bool ok,, uint256 upd) = oracle.getRoundMark(stock, rid);
            if (!ok) break;
            if (upd < earliest) {
                proven = found != 0;
                break;
            }
            found = rid;
            --rid;
        }
        if (!proven) revert Errors.ResolveRoundNotFound(id);
        _resolve(id, mk, found);
    }

    /// @notice Permissionless resolve with an explicit round id (the first round at or after resolveEarliestTs).
    /// @param id Market id.
    /// @param roundId Chainlink round id.
    function resolveWithRound(uint256 id, uint80 roundId) external nonReentrant {
        _resolve(id, _market(id), roundId);
    }

    /// @dev Timing and live-feed preconditions shared by both resolve paths.
    function _checkResolvable(uint256 id, Market storage mk) internal view {
        if (mk.resolved || mk.voided) revert Errors.AlreadySettled(id);
        uint256 earliest = mk.resolveEarliestTs;
        if (block.timestamp < earliest) revert Errors.TooEarly(block.timestamp, earliest);
        if (block.timestamp > earliest + RESOLVE_WINDOW) revert Errors.ResolveWindowOver(id);

        // Live feed must be healthy and cash open right now.
        IAmenOracle.Mark memory live = oracle.getMark(mk.stockToken);
        if (live.frozen) revert Errors.OracleFrozen(live.freezeReason);
        if (!live.cashOpen || oracle.isVespers()) revert Errors.CashClosed();
    }

    function _resolve(uint256 id, Market storage mk, uint80 roundId) internal {
        _checkResolvable(id, mk);
        uint256 earliest = mk.resolveEarliestTs;
        (uint256 px, uint256 upd) = _resolveRound(mk.stockToken, roundId, earliest);

        uint256 ref = mk.closeMarkPrice;
        uint256 diff = px > ref ? px - ref : ref - px;
        mk.resolvePrice = px;
        mk.resolveMarkTs = upd;
        mk.resolveRoundId = roundId;
        mk.moveBps = Math.mulDiv(diff, BPS, ref);
        // Exact comparison: |px − ref| / ref >= strike / 10000
        mk.yesWins = diff * BPS >= mk.strikeBps * ref;

        // Nobody on one side means no counterparty: refund rather than charge a fee to win your own money back.
        if (mk.yesPool == 0 || mk.noPool == 0) {
            mk.voided = true;
            mk.yesWins = false;
            mk.resolveReason = REASON_ONE_SIDED;
            emit Voided(id, REASON_ONE_SIDED);
            return;
        }

        uint256 fee = Math.mulDiv(mk.yesPool + mk.noPool, mk.takerFeeBps, BPS);
        mk.resolved = true;
        mk.resolveReason = REASON_RESOLVED;
        accruedFees += fee;
        emit Resolved(id, ref, px, mk.moveBps, mk.yesWins, roundId, fee);
    }

    /// @dev Validates that `roundId` is the first round at or after `earliest`, printed during cash
    ///      hours and within RESOLVE_WINDOW, and returns its price and timestamp.
    function _resolveRound(address stock, uint80 roundId, uint256 earliest)
        internal
        view
        returns (uint256 px, uint256 upd)
    {
        bool ok;
        (ok, px, upd) = oracle.getRoundMark(stock, roundId);
        if (!ok || roundId == 0 || upd < earliest || upd > earliest + RESOLVE_WINDOW || !oracle.isCashOpenAt(upd)) {
            revert Errors.ResolveRoundInvalid(roundId);
        }
        (bool okPrev,, uint256 updPrev) = oracle.getRoundMark(stock, roundId - 1);
        if (!okPrev || updPrev >= earliest) revert Errors.ResolveRoundInvalid(roundId);
    }

    /// @notice Voids a market that couldn't be resolved within RESOLVE_WINDOW. Stakes are refunded 1:1 with no fee.
    /// @param id Market id.
    function voidMarket(uint256 id) external {
        Market storage mk = _market(id);
        if (mk.resolved || mk.voided) revert Errors.AlreadySettled(id);
        if (block.timestamp <= mk.resolveEarliestTs + RESOLVE_WINDOW) revert Errors.VoidNotYetAllowed(id);
        mk.voided = true;
        mk.resolveReason = REASON_TIMEOUT;
        emit Voided(id, REASON_TIMEOUT);
    }

    /// @notice Pays out a winning position, or refunds stakes if the market was voided.
    /// @param id Market id.
    /// @return amount USDG paid (6 decimals).
    function claim(uint256 id) external nonReentrant returns (uint256 amount) {
        Market storage mk = _market(id);
        if (!mk.resolved && !mk.voided) revert Errors.NotSettled(id);
        Position storage p = _positions[id][msg.sender];
        if (p.claimed) revert Errors.AlreadyClaimed(id, msg.sender);
        amount = _payout(mk, p);
        if (amount == 0) revert Errors.NothingToClaim();
        p.claimed = true;
        emit Claimed(id, msg.sender, amount);
        usdg.safeTransfer(msg.sender, amount);
    }

    /// @dev Parimutuel payout: stake × (total − fee) / winningPool, rounded down. Voided → stake refund.
    function _payout(Market storage mk, Position storage p) internal view returns (uint256) {
        if (mk.voided) return p.yes + p.no;
        uint256 stake = mk.yesWins ? p.yes : p.no;
        if (stake == 0) return 0;
        uint256 winningPool = mk.yesWins ? mk.yesPool : mk.noPool;
        uint256 total = mk.yesPool + mk.noPool;
        uint256 distributable = total - Math.mulDiv(total, mk.takerFeeBps, BPS);
        return Math.mulDiv(stake, distributable, winningPool);
    }

    /// @notice Sends accrued taker fees to feeRecipient.
    function claimFees() external nonReentrant {
        uint256 amt = accruedFees;
        if (amt == 0) revert Errors.NothingToClaim();
        accruedFees = 0;
        emit FeesClaimed(feeRecipient, amt);
        usdg.safeTransfer(feeRecipient, amt);
    }

    // ───────────────────────────── views ─────────────────────────────

    /// @notice Returns a market.
    function getMarket(uint256 id) external view returns (Market memory) {
        return _markets[id];
    }

    /// @notice Returns a user's position.
    function positionOf(uint256 id, address user) external view returns (Position memory) {
        return _positions[id][user];
    }

    /// @notice What `claim` would pay right now (0 if unsettled, lost or already claimed).
    function claimable(uint256 id, address user) external view returns (uint256) {
        Market storage mk = _markets[id];
        Position storage p = _positions[id][user];
        if ((!mk.resolved && !mk.voided) || p.claimed) return 0;
        return _payout(mk, p);
    }

    /// @notice Hypothetical payout for `amount` staked on a side now, if that side wins (6 dec, after fee).
    function quote(uint256 id, bool yes, uint256 amount) external view returns (uint256) {
        Market storage mk = _markets[id];
        uint256 total = mk.yesPool + mk.noPool + amount;
        uint256 side = (yes ? mk.yesPool : mk.noPool) + amount;
        if (side == 0) return 0;
        uint256 distributable = total - Math.mulDiv(total, takerFeeBps, BPS);
        return Math.mulDiv(amount, distributable, side);
    }

    // ───────────────────────────── admin ─────────────────────────────

    /// @notice Allow-lists a Stock Token for market creation (Phase 1: NVDA only). Its oracle feed must be registered.
    function setStockAllowed(address stockToken, bool allowed) external onlyOwner {
        if (allowed) oracle.getMark(stockToken); // reverts UnknownStock if no feed
        stockAllowed[stockToken] = allowed;
        emit StockAllowedSet(stockToken, allowed);
    }

    /// @notice Updates fee recipient, taker fee (for future markets) and the per-market notional ceiling.
    function setFeeParams(address feeRecipient_, uint256 takerFeeBps_, uint256 maxNotionalLimit_) external onlyOwner {
        if (feeRecipient_ == address(0)) revert Errors.ZeroAddress();
        if (takerFeeBps_ > MAX_TAKER_FEE_BPS || maxNotionalLimit_ == 0) revert Errors.InvalidParam();
        feeRecipient = feeRecipient_;
        takerFeeBps = takerFeeBps_;
        maxNotionalLimit = maxNotionalLimit_;
        emit FeeParamsSet(feeRecipient_, takerFeeBps_, maxNotionalLimit_);
    }

    function _market(uint256 id) internal view returns (Market storage mk) {
        mk = _markets[id];
        if (mk.id == 0) revert Errors.UnknownMarket(id);
    }
}

