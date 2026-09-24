// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DecimalLib} from "../../src/libraries/DecimalLib.sol";

contract DecimalLibHarness {
    function toWad(uint256 a, uint8 d) external pure returns (uint256) {
        return DecimalLib.toWad(a, d);
    }
}

contract DecimalLibTest is Test {
    DecimalLibHarness h = new DecimalLibHarness();

    function test_Usdg6ToWad() public pure {
        assertEq(DecimalLib.usdgToWad(1e6), 1e18); // 1.000000 USDG -> 1e18
        assertEq(DecimalLib.usdgToWad(100e6), 100e18);
        assertEq(DecimalLib.usdgToWad(1), 1e12); // 0.000001 USDG
    }

    function test_WadToUsdg6RoundsDown() public pure {
        assertEq(DecimalLib.wadToUsdg(1e18), 1e6);
        assertEq(DecimalLib.wadToUsdg(1e12 - 1), 0);
        assertEq(DecimalLib.wadToUsdg(1.9999999e18), 1_999_999);
        assertEq(DecimalLib.wadToUsdgUp(1e12 + 1), 2);
    }

    function test_Chainlink8ToWad() public pure {
        assertEq(DecimalLib.toWad(180_00000000, 8), 180e18); // $180.00 CL8 -> 180e18
        assertEq(DecimalLib.toWad(1, 8), 1e10);
        assertEq(DecimalLib.toWad(5e18, 18), 5e18);
        assertEq(DecimalLib.toWad(1e20, 20), 1e18);
        assertEq(DecimalLib.fromWad(180e18, 8), 180_00000000);
        assertEq(DecimalLib.fromWad(1e18, 6), 1e6);
    }

    function test_RevertWhen_DecimalsTooLarge() public {
        vm.expectRevert(abi.encodeWithSelector(DecimalLib.DecimalsTooLarge.selector, uint8(37)));
        h.toWad(1, 37);
    }

    function test_StockValueUsdg() public pure {
        // 2.5 NVDA (18 dec) at $180 -> $450.000000 USDG
        assertEq(DecimalLib.stockValueUsdg(2.5e18, 180e18), 450e6);
        assertEq(DecimalLib.stockValueWad(2.5e18, 180e18), 450e18);
    }

    function testFuzz_RoundTrip6_18(uint128 a6) public pure {
        assertEq(DecimalLib.wadToUsdg(DecimalLib.usdgToWad(a6)), a6);
    }

    function testFuzz_RoundTrip8_18_6(uint64 px8) public pure {
        uint256 w = DecimalLib.toWad(px8, 8);
        assertEq(DecimalLib.fromWad(w, 8), px8);
        // 8 -> 18 -> 6 equals truncation of the last 2 CL digits
        assertEq(DecimalLib.wadToUsdg(w), uint256(px8) / 100);
    }
}
