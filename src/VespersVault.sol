// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IAmenOracle} from "./interfaces/IAmenOracle.sol";
import {ISwapAdapter} from "./interfaces/ISwapAdapter.sol";
import {AmenAccess} from "./base/AmenAccess.sol";
import {NetworkGuard} from "./libraries/NetworkGuard.sol";
import {DecimalLib} from "./libraries/DecimalLib.sol";
import {Errors} from "./libraries/Errors.sol";

/// @title VespersVault
/// @notice USDG vault that carries Stock Token inventory (Phase 1: NVDA) only while the US cash
///         market is closed ("Vespers") and flattens back to USDG once cash is open.
///         Deposits and withdrawals are always in USDG (ERC-4626 asset = USDG, 6 decimals).
/// @dev Session and oracle rationale:
///      - A Vespers mark is usually stale (feeds run about 24/5). An LP who could enter or exit
///        against a stale NAV while the vault holds stock would arbitrage the other LPs. So while
///        stock is held during Vespers, deposits and withdrawals are locked; liquidity exits at
///        the next flatten.
///      - While cash is open the mark must be fresh (<= 30 min) or the oracle freezes it, and then
///        deposits and withdrawals lock.
///      - Stock inventory is tracked internally (`stockHeld`) rather than via balanceOf, so
///        donating stock can't lock the vault or skew NAV.
///      - Stock is valued as raw * Chainlink price. uiMultiplier is never applied (see SPEC §2).
contract VespersVault is ERC4626, AmenAccess, ReentrancyGuard, NetworkGuard {
    using SafeERC20 for IERC20;

    struct Cycle {
        uint256 id;
        uint256 startTs; // cash close (Vespers start)
        uint256 endTs; // next cash open (flatten)
        uint256 navStart; // USDG-6
        uint256 navEnd; // USDG-6
        int256 realizedPnl; // USDG-6, net of LP flows, before perf fee
        uint256 perfFee; // USDG-6 accrued to feeRecipient
    }

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_PERF_FEE_BPS = 3_000;
    uint256 public constant MAX_DEVIATION_BPS = 2_000;

    IAmenOracle public immutable oracle;
    IERC20 public immutable stock;
    IERC20 internal immutable _usdg;

    ISwapAdapter public swapAdapter;
    address public feeRecipient;
    uint256 public maxInventoryBps = 5_000; // 50% of NAV
    uint256 public perfFeeBps = 1_000; // 10% of positive cycle PnL
    uint256 public mgmtFeeBps; // reserved, 0 in Phase 1 (not charged)
    uint256 public maxDeviationBps = 500; // swap price vs oracle mark
    bool public allowInKind; // default false: force flatten first

    uint256 public stockHeld; // raw 18-dec stock units owned by the vault
    uint256 public accruedFees; // USDG-6 owed to feeRecipient, excluded from NAV

    uint256 public currentCycleId;
    bool public cycleActive;
    int256 public cycleNetFlows; // deposits minus withdrawals during the active cycle, USDG-6
    mapping(uint256 id => Cycle) internal _cycles;

    event CycleStarted(uint256 indexed id, uint256 startTs, uint256 navStart);
    event CycleEnded(uint256 indexed id, uint256 endTs, uint256 navEnd, int256 realizedPnl, uint256 perfFee);
    event InventoryChanged(
        bool indexed buy, uint256 usdgAmount, uint256 stockAmount, uint256 stockHeldAfter, uint256 markPrice
    );
    event FeesClaimed(address indexed to, uint256 amount);
    event ParamsSet(uint256 maxInventoryBps, uint256 perfFeeBps, uint256 maxDeviationBps, bool allowInKind);
    event SwapAdapterSet(address adapter);
    event FeeRecipientSet(address recipient);
    event RedeemedInKind(address indexed owner, address indexed receiver, uint256 shares, uint256 usdgOut, uint256 stockOut);

    /// @param owner_ Owner (Ownable2Step).
    /// @param usdg_ USDG token, which must have 6 decimals.
    /// @param stock_ Stock Token (18 decimals) this vault inventories.
    /// @param oracle_ AmenOracle with a feed registered for `stock_`.
    /// @param feeRecipient_ Receiver of performance fees.
    constructor(address owner_, address usdg_, address stock_, address oracle_, address feeRecipient_)
        ERC4626(IERC20(usdg_))
        ERC20("Amen Vespers NVDA/USDG", "vspNVDA")
        AmenAccess(owner_)
    {
        if (stock_ == address(0) || oracle_ == address(0) || feeRecipient_ == address(0)) {
            revert Errors.ZeroAddress();
        }
        // USDG is 6 decimals; Stock Tokens are 18. Refuse anything else rather than mis-scale NAV.
        if (IERC20Metadata(usdg_).decimals() != 6) revert Errors.InvalidParam();
        if (IERC20Metadata(stock_).decimals() != 18) revert Errors.InvalidParam();
        _usdg = IERC20(usdg_);
        stock = IERC20(stock_);
        oracle = IAmenOracle(oracle_);
        feeRecipient = feeRecipient_;
        // Fails fast if the oracle doesn't know this stock.
        oracle.getMark(stock_);
    }

    // ───────────────────────────── ERC-4626 accounting ─────────────────────────────

    /// @dev Shares have 18 decimals (6 + 12). The offset also blunts first-depositor inflation attacks.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 12;
    }

    /// @notice NAV in USDG (6 decimals): free USDG + stockHeld × mark, rounded down.
    /// @dev Uses the latest mark even when it is stale or frozen, so previews stay informative;
    ///      the state-changing functions enforce the freeze rules. A non-positive or erroring
    ///      mark values stock at 0.
    function totalAssets() public view override returns (uint256) {
        uint256 held = stockHeld;
        uint256 stockValue;
        if (held != 0) stockValue = DecimalLib.stockValueUsdg(held, oracle.getMark(address(stock)).priceUsd);
        return usdgAvailable() + stockValue;
    }

    /// @notice USDG held by the vault minus fees owed to feeRecipient.
    function usdgAvailable() public view returns (uint256) {
        uint256 bal = _usdg.balanceOf(address(this));
        return bal > accruedFees ? bal - accruedFees : 0;
    }

    /// @inheritdoc ERC4626
    function deposit(uint256 assets, address receiver) public override nonReentrant returns (uint256) {
        return super.deposit(assets, receiver);
    }

    /// @inheritdoc ERC4626
    function mint(uint256 shares, address receiver) public override nonReentrant returns (uint256) {
        return super.mint(shares, receiver);
    }

    /// @inheritdoc ERC4626
    function withdraw(uint256 assets, address receiver, address owner_)
        public
        override
        nonReentrant
        returns (uint256)
    {
        return super.withdraw(assets, receiver, owner_);
    }

    /// @inheritdoc ERC4626
    function redeem(uint256 shares, address receiver, address owner_)
        public
        override
        nonReentrant
        returns (uint256)
    {
        return super.redeem(shares, receiver, owner_);
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        _requireNavUsable();
        if (cycleActive) cycleNetFlows += int256(assets);
        super._deposit(caller, receiver, assets, shares);
    }

    function _withdraw(address caller, address receiver, address owner_, uint256 assets, uint256 shares)
        internal
        override
    {
        _requireNavUsable();
        // With stock still held during cash-open, payouts come only from free USDG; the keeper
        // must flatten first. Phase 1 never pays in kind implicitly.
        if (assets > usdgAvailable()) revert Errors.CashOpenFlattenRequired();
        if (cycleActive) cycleNetFlows -= int256(assets);
        super._withdraw(caller, receiver, owner_, assets, shares);
    }

    /// @dev Session/freeze gate for NAV-based entry and exit. See contract natspec.
    function _requireNavUsable() internal view {
        IAmenOracle.Mark memory m = oracle.getMark(address(stock));
        if (stockHeld == 0) {
            // Flat vault: NAV is exact USDG. The spec still locks entry/exit during a cash-open freeze.
            if (m.frozen && m.cashOpen) revert Errors.OracleFrozen(m.freezeReason);
            return;
        }
        if (m.frozen) revert Errors.OracleFrozen(m.freezeReason);
        if (!m.cashOpen) revert Errors.VespersInventoryLocked();
    }

    /// @notice Oracle-free pro-rata exit (USDG + stock). Disabled unless the owner sets `allowInKind`.
    /// @param shares Vault shares to burn.
    /// @param receiver Receiver of USDG and stock.
    /// @param owner_ Share owner (allowance is spent if caller != owner_).
    /// @return usdgOut USDG paid (6 decimals).
    /// @return stockOut Raw stock paid (18 decimals).
    function redeemInKind(uint256 shares, address receiver, address owner_)
        external
        nonReentrant
        returns (uint256 usdgOut, uint256 stockOut)
    {
        if (!allowInKind) revert Errors.InKindDisabled();
        if (shares == 0) revert Errors.ZeroAmount();
        uint256 supply = totalSupply();
        usdgOut = Math.mulDiv(usdgAvailable(), shares, supply);
        stockOut = Math.mulDiv(stockHeld, shares, supply);

        if (msg.sender != owner_) _spendAllowance(owner_, msg.sender, shares);
        _burn(owner_, shares);
        stockHeld -= stockOut;
        if (cycleActive) {
            uint256 px = oracle.getMark(address(stock)).priceUsd;
            cycleNetFlows -= int256(usdgOut + DecimalLib.stockValueUsdg(stockOut, px));
        }

        if (usdgOut != 0) _usdg.safeTransfer(receiver, usdgOut);
        if (stockOut != 0) stock.safeTransfer(receiver, stockOut);
        emit RedeemedInKind(owner_, receiver, shares, usdgOut, stockOut);
    }

    // ───────────────────────────── inventory ─────────────────────────────

    /// @notice Buys stock with vault USDG. Vespers only, with an unfrozen mark, capped at `maxInventoryBps` of NAV.
    /// @param usdgIn USDG to spend (6 decimals).
    /// @param minStockOut Minimum raw stock to receive (18 decimals).
    /// @return stockOut Raw stock received.
    function buyInventory(uint256 usdgIn, uint256 minStockOut)
        external
        onlyKeeperOrOwner
        nonReentrant
        returns (uint256 stockOut)
    {
        if (!oracle.isVespers()) revert Errors.NotVespers();
        if (!cycleActive) revert Errors.NoActiveCycle();
        if (usdgIn == 0) revert Errors.ZeroAmount();
        if (usdgIn > usdgAvailable()) revert Errors.InvalidParam();
        IAmenOracle.Mark memory m = oracle.getMark(address(stock));
        if (m.frozen) revert Errors.OracleFrozen(m.freezeReason);

        stockOut = _swap(address(_usdg), address(stock), usdgIn, minStockOut);

        // Execution price (USD per raw token, 18 dec) may be at most mark × (1 + deviation).
        uint256 execPx = Math.mulDiv(DecimalLib.usdgToWad(usdgIn), 1e18, stockOut);
        if (execPx > Math.mulDiv(m.priceUsd, BPS + maxDeviationBps, BPS)) {
            revert Errors.PriceDeviation(execPx, m.priceUsd);
        }

        stockHeld += stockOut;
        uint256 stockValue = DecimalLib.stockValueUsdg(stockHeld, m.priceUsd);
        uint256 cap = Math.mulDiv(totalAssets(), maxInventoryBps, BPS);
        if (stockValue > cap) revert Errors.InventoryCapExceeded(stockValue, cap);

        emit InventoryChanged(true, usdgIn, stockOut, stockHeld, m.priceUsd);
    }

    /// @notice Sells stock for USDG (flattening). Allowed in any session while the mark is unfrozen.
    /// @param stockIn Raw stock to sell (18 decimals), <= stockHeld.
    /// @param minUsdgOut Minimum USDG to receive (6 decimals).
    /// @return usdgOut USDG received.
    function sellInventory(uint256 stockIn, uint256 minUsdgOut)
        public
        onlyKeeperOrOwner
        nonReentrant
        returns (uint256 usdgOut)
    {
        if (stockIn == 0) revert Errors.ZeroAmount();
        if (stockIn > stockHeld) revert Errors.InvalidParam();
        IAmenOracle.Mark memory m = oracle.getMark(address(stock));
        if (m.frozen) revert Errors.OracleFrozen(m.freezeReason);

        usdgOut = _swap(address(stock), address(_usdg), stockIn, minUsdgOut);

        // Execution price may be at least mark × (1 − deviation).
        uint256 execPx = Math.mulDiv(DecimalLib.usdgToWad(usdgOut), 1e18, stockIn);
        if (execPx < Math.mulDiv(m.priceUsd, BPS - maxDeviationBps, BPS)) {
            revert Errors.PriceDeviation(execPx, m.priceUsd);
        }

        stockHeld -= stockIn;
        emit InventoryChanged(false, usdgOut, stockIn, stockHeld, m.priceUsd);
    }

    /// @notice Sells all held stock.
    /// @param minUsdgOut Minimum USDG to receive.
    function flatten(uint256 minUsdgOut) external returns (uint256) {
        return sellInventory(stockHeld, minUsdgOut);
    }

    /// @dev Swap via the adapter, measuring real balance deltas instead of trusting its return value.
    function _swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        internal
        returns (uint256 out)
    {
        ISwapAdapter adapter = swapAdapter;
        if (address(adapter) == address(0)) revert Errors.NoSwapAdapter();
        uint256 inBefore = IERC20(tokenIn).balanceOf(address(this));
        uint256 outBefore = IERC20(tokenOut).balanceOf(address(this));
        IERC20(tokenIn).forceApprove(address(adapter), amountIn);
        adapter.swap(tokenIn, tokenOut, amountIn, minOut, address(this));
        IERC20(tokenIn).forceApprove(address(adapter), 0);
        if (inBefore - IERC20(tokenIn).balanceOf(address(this)) > amountIn) revert Errors.InvalidParam();
        out = IERC20(tokenOut).balanceOf(address(this)) - outBefore;
        if (out < minOut || out == 0) revert Errors.Slippage(out, minOut);
    }

    // ───────────────────────────── cycles ─────────────────────────────

    /// @notice Opens a Vespers cycle. Permissionless during Vespers when the vault is flat, so navStart is exact USDG.
    function startCycle() external nonReentrant {
        if (!oracle.isVespers()) revert Errors.NotVespers();
        if (cycleActive) revert Errors.CycleActive();
        if (stockHeld != 0) revert Errors.NotFlat();
        uint256 id = ++currentCycleId;
        uint256 nav = totalAssets();
        _cycles[id] = Cycle({
            id: id, startTs: block.timestamp, endTs: 0, navStart: nav, navEnd: 0, realizedPnl: 0, perfFee: 0
        });
        cycleActive = true;
        cycleNetFlows = 0;
        emit CycleStarted(id, block.timestamp, nav);
    }

    /// @notice Closes the active cycle once cash is open and inventory is flat, then accrues the perf fee on realized profit.
    function endCycle() external nonReentrant {
        if (!cycleActive) revert Errors.NoActiveCycle();
        if (!oracle.isCashOpen()) revert Errors.CashClosed();
        if (stockHeld != 0) revert Errors.NotFlat();
        Cycle storage c = _cycles[currentCycleId];
        uint256 navEnd = totalAssets();
        int256 pnl = int256(navEnd) - int256(c.navStart) - cycleNetFlows;
        uint256 fee;
        if (pnl > 0) {
            fee = Math.mulDiv(uint256(pnl), perfFeeBps, BPS);
            accruedFees += fee;
        }
        c.endTs = block.timestamp;
        c.navEnd = navEnd;
        c.realizedPnl = pnl;
        c.perfFee = fee;
        cycleActive = false;
        cycleNetFlows = 0;
        emit CycleEnded(c.id, block.timestamp, navEnd, pnl, fee);
    }

    /// @notice Returns a cycle by id.
    function cycles(uint256 id) external view returns (Cycle memory) {
        return _cycles[id];
    }

    /// @notice Sends accrued performance fees to feeRecipient (pull model, so a frozen recipient can't block cycles).
    function claimFees() external nonReentrant {
        uint256 amt = accruedFees;
        if (amt == 0) revert Errors.NothingToClaim();
        accruedFees = 0;
        _usdg.safeTransfer(feeRecipient, amt);
        emit FeesClaimed(feeRecipient, amt);
    }

    // ───────────────────────────── views ─────────────────────────────

    /// @notice One-call snapshot for UIs.
    /// @return usdgFree Free USDG (6 dec).
    /// @return stockRaw Raw stock held (18 dec).
    /// @return stockValueUsdg Stock value at mark (6 dec).
    /// @return nav totalAssets (6 dec).
    /// @return markPrice Oracle mark (18 dec USD).
    /// @return frozen Mark frozen flag.
    /// @return freezeReason Mark freeze reason.
    function inventory()
        external
        view
        returns (
            uint256 usdgFree,
            uint256 stockRaw,
            uint256 stockValueUsdg,
            uint256 nav,
            uint256 markPrice,
            bool frozen,
            bytes32 freezeReason
        )
    {
        IAmenOracle.Mark memory m = oracle.getMark(address(stock));
        usdgFree = usdgAvailable();
        stockRaw = stockHeld;
        stockValueUsdg = DecimalLib.stockValueUsdg(stockRaw, m.priceUsd);
        nav = usdgFree + stockValueUsdg;
        markPrice = m.priceUsd;
        frozen = m.frozen;
        freezeReason = m.freezeReason;
    }

    // ───────────────────────────── admin ─────────────────────────────

    /// @notice Sets the swap venue used for inventory moves.
    function setSwapAdapter(address adapter) external onlyOwner {
        swapAdapter = ISwapAdapter(adapter);
        emit SwapAdapterSet(adapter);
    }

    /// @notice Sets the performance fee recipient.
    function setFeeRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert Errors.ZeroAddress();
        feeRecipient = recipient;
        emit FeeRecipientSet(recipient);
    }

    /// @notice Updates risk and fee parameters.
    /// @param maxInventoryBps_ Max stock value as a share of NAV (<= 10000).
    /// @param perfFeeBps_ Performance fee on positive cycle PnL (<= 3000).
    /// @param maxDeviationBps_ Max swap price deviation vs the mark (<= 2000).
    /// @param allowInKind_ Enables `redeemInKind`.
    function setParams(uint256 maxInventoryBps_, uint256 perfFeeBps_, uint256 maxDeviationBps_, bool allowInKind_)
        external
        onlyOwner
    {
        if (maxInventoryBps_ > BPS || perfFeeBps_ > MAX_PERF_FEE_BPS || maxDeviationBps_ > MAX_DEVIATION_BPS) {
            revert Errors.InvalidParam();
        }
        maxInventoryBps = maxInventoryBps_;
        perfFeeBps = perfFeeBps_;
        maxDeviationBps = maxDeviationBps_;
        allowInKind = allowInKind_;
        emit ParamsSet(maxInventoryBps_, perfFeeBps_, maxDeviationBps_, allowInKind_);
    }

    /// @inheritdoc ERC4626
    function decimals() public view override(ERC4626) returns (uint8) {
        return super.decimals();
    }
}
