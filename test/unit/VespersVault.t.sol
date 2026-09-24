// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AmenTestBase} from "../utils/AmenTestBase.sol";
import {ReentrantUSDG} from "../utils/ReentrantUSDG.sol";
import {VespersVault} from "../../src/VespersVault.sol";
import {AmenOracle} from "../../src/AmenOracle.sol";
import {MockSwapAdapter} from "../../src/mocks/MockSwapAdapter.sol";
import {Errors} from "../../src/libraries/Errors.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract VespersVaultTest is AmenTestBase {
    VespersVault vault;
    MockSwapAdapter adapter;

    function setUp() public override {
        super.setUp();
        vault = new VespersVault(owner, address(usdg), address(nvda), address(oracle), feeRecipient);
        adapter = new MockSwapAdapter(address(usdg), address(nvda), NVDA_PX_18);
        vm.startPrank(owner);
        vault.setSwapAdapter(address(adapter));
        vault.setKeeper(keeper, true);
        vm.stopPrank();

        // Friday 2026-09-25: last round at 15:55 NY, then the bell.
        tickAt(NVDA_PX_8, utc(2026, 9, 25, 19, 55));
        vm.warp(utc(2026, 9, 25, 20, 5)); // Vespers

        _fund(alice, 1_000e6);
        _fund(bob, 1_000e6);
    }

    function _fund(address who, uint256 amt) internal {
        usdg.mint(who, amt);
        vm.prank(who);
        usdg.approve(address(vault), type(uint256).max);
    }

    function _deposit(address who, uint256 amt) internal returns (uint256) {
        vm.prank(who);
        return vault.deposit(amt, who);
    }

    function _openCycleWithInventory(uint256 usdgIn) internal {
        vault.startCycle();
        vm.prank(keeper);
        vault.buyInventory(usdgIn, 0);
    }

    // ───────────── basics ─────────────

    function test_DepositVespersFlat() public {
        uint256 shares = _deposit(alice, 100e6);
        assertEq(shares, 100e18, "shares are 18-dec");
        assertEq(vault.totalAssets(), 100e6, "NAV is USDG-6, not 1e18-scaled");
        assertEq(vault.convertToAssets(1e18), 1e6);
        assertEq(vault.decimals(), 18);
    }

    function test_RevertWhen_UsdgNot6Decimals() public {
        vm.expectRevert(Errors.InvalidParam.selector);
        new VespersVault(owner, address(nvda), address(nvda), address(oracle), feeRecipient);
    }

    function test_RevertWhen_WrongChain() public {
        vm.chainId(1);
        vm.expectRevert(abi.encodeWithSelector(Errors.WrongChain.selector, uint256(1)));
        new VespersVault(owner, address(usdg), address(nvda), address(oracle), feeRecipient);
    }

    // ───────────── freeze gating ─────────────

    function test_RevertWhen_DepositDuringCashOpenFreeze() public {
        vm.warp(utc(2026, 9, 28, 13, 45)); // Monday open, feed still Friday -> STALE
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Errors.OracleFrozen.selector, R_STALE));
        vault.deposit(100e6, alice);
    }

    function test_RevertWhen_DepositWhilePausedWithInventory() public {
        _deposit(alice, 100e6);
        _openCycleWithInventory(40e6);
        nvda.setOraclePaused(true);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Errors.OracleFrozen.selector, R_PAUSED));
        vault.deposit(100e6, bob);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Errors.OracleFrozen.selector, R_PAUSED));
        vault.withdraw(1e6, alice, alice);
    }

    function test_RevertWhen_ManualFreezeDuringCashOpen() public {
        _deposit(alice, 100e6);
        vm.warp(utc(2026, 9, 28, 14, 0));
        tick(NVDA_PX_8);
        vm.prank(owner);
        oracle.setManualFreeze(true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Errors.OracleFrozen.selector, R_MANUAL));
        vault.withdraw(1e6, alice, alice);
    }

    function test_VespersInventoryLocksEntryAndExit() public {
        _deposit(alice, 100e6);
        _openCycleWithInventory(40e6);
        vm.prank(bob);
        vm.expectRevert(Errors.VespersInventoryLocked.selector);
        vault.deposit(10e6, bob);
        vm.prank(alice);
        vm.expectRevert(Errors.VespersInventoryLocked.selector);
        vault.redeem(1e18, alice, alice);
    }

    // ───────────── session permissions on swaps ─────────────

    function test_RevertWhen_BuyInventoryDuringCashOpen() public {
        _deposit(alice, 100e6);
        vault.startCycle();
        vm.warp(utc(2026, 9, 28, 14, 0));
        tick(NVDA_PX_8);
        vm.prank(keeper);
        vm.expectRevert(Errors.NotVespers.selector);
        vault.buyInventory(10e6, 0);
    }

    function test_RevertWhen_BuyInventoryNotKeeper() public {
        _deposit(alice, 100e6);
        vault.startCycle();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Errors.NotKeeper.selector, alice));
        vault.buyInventory(10e6, 0);
    }

    function test_RevertWhen_BuyInventoryPaused() public {
        _deposit(alice, 100e6);
        vault.startCycle();
        nvda.setOraclePaused(true);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(Errors.OracleFrozen.selector, R_PAUSED));
        vault.buyInventory(10e6, 0);
    }

    function test_RevertWhen_InventoryCapExceeded() public {
        _deposit(alice, 100e6);
        vault.startCycle();
        vm.prank(keeper);
        vm.expectPartialRevert(Errors.InventoryCapExceeded.selector);
        vault.buyInventory(60e6, 0);
    }

    function test_RevertWhen_BuyPriceDeviates() public {
        _deposit(alice, 100e6);
        vault.startCycle();
        adapter.setPrice(181e18); // 0.56% above mark (> 50 bps)
        vm.prank(keeper);
        vm.expectRevert();
        vault.buyInventory(10e6, 0);
    }

    function test_DeviationBoundIs50Bps() public {
        _deposit(alice, 100e6);
        vault.startCycle();
        adapter.setPrice(180.8e18); // 0.44% above mark: allowed
        vm.prank(keeper);
        vault.buyInventory(10e6, 0);
        // flatten 0.56% below mark: rejected
        adapter.setPrice(179e18);
        uint256 held = vault.stockHeld();
        vm.prank(keeper);
        vm.expectPartialRevert(Errors.PriceDeviation.selector);
        vault.sellInventory(held, 0);
        // owner cannot loosen past the 50 bps cap
        vm.prank(owner);
        vm.expectRevert(Errors.InvalidParam.selector);
        vault.setParams(5000, 1000, 51, false);
    }

    function test_SellAllowedDuringCashOpen_BuyBlocked() public {
        _deposit(alice, 100e6);
        _openCycleWithInventory(45e6);
        assertGt(vault.stockHeld(), 0);
        vm.warp(utc(2026, 9, 28, 13, 31));
        tick(NVDA_PX_8);
        vm.prank(keeper);
        vault.flatten(0);
        assertEq(vault.stockHeld(), 0);
    }

    // ───────────── valuation ─────────────

    function test_UiMultiplierIgnoredInValuation() public {
        _deposit(alice, 100e6);
        _openCycleWithInventory(36e6); // 0.2 NVDA at $180
        assertEq(vault.stockHeld(), 0.2e18);
        uint256 navBefore = vault.totalAssets();
        assertEq(navBefore, 100e6);
        nvda.setUIMultiplier(2e18); // 2:1 split display; price feed already accounts for it
        assertEq(vault.totalAssets(), navBefore);
    }

    function test_StockDonationIgnored() public {
        _deposit(alice, 100e6);
        nvda.mint(address(vault), 1e18);
        assertEq(vault.totalAssets(), 100e6);
        // still flat -> not locked
        _deposit(bob, 1e6);
    }

    // ───────────── cycle PnL ─────────────

    function test_CycleRealizedPnlAndPerfFee() public {
        _deposit(alice, 100e6);
        vault.startCycle();
        vm.prank(keeper);
        uint256 got = vault.buyInventory(36e6, 0); // 0.2 NVDA @ 180
        assertEq(got, 0.2e18);

        vm.prank(alice);
        vm.expectRevert(Errors.CashClosed.selector);
        vault.endCycle();

        // Monday open: NVDA marks 185 and the keeper flattens at 185
        vm.warp(utc(2026, 9, 28, 13, 31));
        tick(185_00000000);
        adapter.setPrice(185e18);
        vm.prank(keeper);
        vault.flatten(0);
        vault.endCycle();

        VespersVault.Cycle memory c = vault.cycles(1);
        assertEq(c.navStart, 100e6);
        assertEq(c.navEnd, 101e6);
        assertEq(c.realizedPnl, 1e6);
        assertEq(c.perfFee, 0.1e6);
        assertEq(vault.totalAssets(), 100.9e6);
        vault.claimFees();
        assertEq(usdg.balanceOf(feeRecipient), 0.1e6);

        // LP exits with profit net of fee
        vm.prank(alice);
        vault.redeem(100e18, alice, alice);
        assertApproxEqAbs(usdg.balanceOf(alice), 1_000e6 + 0.9e6, 1);
    }

    function test_CycleNetFlowsExcludedFromPnl() public {
        _deposit(alice, 100e6);
        _openCycleWithInventory(36e6);
        vm.warp(utc(2026, 9, 28, 13, 31));
        tick(NVDA_PX_8);
        // cash open, inventory still held, fresh mark -> deposit allowed and counted as flow
        _deposit(bob, 50e6);
        vm.prank(keeper);
        vault.flatten(0);
        vault.endCycle();
        assertEq(vault.cycles(1).realizedPnl, 0);
    }

    function test_RevertWhen_WithdrawNeedsFlatten() public {
        _deposit(alice, 100e6);
        _openCycleWithInventory(45e6);
        vm.warp(utc(2026, 9, 28, 13, 31));
        tick(NVDA_PX_8);
        vm.prank(alice);
        vm.expectRevert(Errors.CashOpenFlattenRequired.selector);
        vault.withdraw(80e6, alice, alice);
        vm.prank(alice);
        vault.withdraw(50e6, alice, alice); // within free USDG
    }

    function test_RevertWhen_StartCycleDuringCashOpen() public {
        vm.warp(utc(2026, 9, 28, 14, 0));
        vm.expectRevert(Errors.NotVespers.selector);
        vault.startCycle();
    }

    // ───────────── in kind ─────────────

    function test_RedeemInKind() public {
        _deposit(alice, 100e6);
        _openCycleWithInventory(36e6);
        vm.prank(alice);
        vm.expectRevert(Errors.InKindDisabled.selector);
        vault.redeemInKind(50e18, alice, alice);
        vm.prank(owner);
        vault.setParams(5000, 1000, 50, true);
        vm.prank(alice);
        (uint256 u, uint256 s) = vault.redeemInKind(50e18, alice, alice);
        assertEq(u, 32e6);
        assertEq(s, 0.1e18);
        assertEq(nvda.balanceOf(alice), 0.1e18);
    }

    // ───────────── guarded-launch deposit cap ─────────────

    function test_DepositCapDefaultsToUncapped() public view {
        assertEq(vault.depositCap(), type(uint256).max);
        assertEq(vault.maxDeposit(alice), type(uint256).max);
        assertEq(vault.maxMint(alice), type(uint256).max);
    }

    function test_DepositCapEnforced() public {
        vm.prank(owner);
        vault.setDepositCap(150e6);
        _deposit(alice, 100e6);
        assertEq(vault.maxDeposit(bob), 50e6);
        assertEq(vault.maxMint(bob), 50e18);
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxDeposit.selector, bob, 50e6 + 1, 50e6)
        );
        vault.deposit(50e6 + 1, bob);
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxMint.selector, bob, 50e18 + 1, 50e18)
        );
        vault.mint(50e18 + 1, bob);
        _deposit(bob, 50e6); // exactly to the cap
        assertEq(vault.totalAssets(), 150e6);
        assertEq(vault.maxDeposit(bob), 0);
    }

    function test_DepositCapLoweredBelowNavBlocksOnlyNewDeposits() public {
        _deposit(alice, 100e6);
        vm.prank(owner);
        vault.setDepositCap(10e6);
        assertEq(vault.maxDeposit(bob), 0);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxDeposit.selector, bob, 1e6, 0));
        vault.deposit(1e6, bob);
        vm.prank(alice);
        vault.withdraw(100e6, alice, alice); // exits are never capped
        assertEq(vault.totalAssets(), 0);
    }

    function test_RevertWhen_SetDepositCapNotOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vault.setDepositCap(1);
    }

    // ───────────── reentrancy ─────────────

    function test_ReentrancyOnWithdrawBlocked() public {
        ReentrantUSDG evil = new ReentrantUSDG();
        VespersVault v2 = new VespersVault(owner, address(evil), address(nvda), address(oracle), feeRecipient);
        evil.mint(alice, 100e6);
        vm.startPrank(alice);
        evil.approve(address(v2), type(uint256).max);
        v2.deposit(100e6, alice);
        v2.approve(address(v2), type(uint256).max);
        vm.stopPrank();
        // On the outbound transfer, the token re-enters v2.withdraw.
        evil.arm(address(v2), abi.encodeCall(VespersVault.withdraw, (1e6, alice, alice)));
        vm.prank(alice);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        v2.withdraw(10e6, alice, alice);
    }

    // ───────────── fuzz ─────────────

    function testFuzz_DepositRedeemNoFreeValue(uint256 a, uint256 b) public {
        a = bound(a, 1, 1_000e6);
        b = bound(b, 1, 1_000e6);
        _deposit(alice, a);
        uint256 sb = _deposit(bob, b);
        vm.prank(bob);
        uint256 out = vault.redeem(sb, bob, bob);
        assertLe(out, b);
        assertApproxEqAbs(out, b, 1);
    }
}
