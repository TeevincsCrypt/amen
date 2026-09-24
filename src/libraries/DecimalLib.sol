// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title DecimalLib
/// @notice Conversions between USDG (6), Chainlink (usually 8) and Amen's internal 18-decimal
///         representation. Internal math is always 18 decimals; we scale only at the USDG boundary.
/// @dev USDG is 6 decimals. If a NAV looks 1,000,000x too big, someone skipped `wadToUsdg`.
library DecimalLib {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant USDG_DECIMALS = 6;
    uint256 internal constant USDG_TO_WAD = 1e12;

    error DecimalsTooLarge(uint8 decimals);

    /// @notice USDG (6 decimals) to WAD (18 decimals). Exact.
    function usdgToWad(uint256 amount6) internal pure returns (uint256) {
        return amount6 * USDG_TO_WAD;
    }

    /// @notice WAD to USDG, rounded down. Use this when paying out or valuing assets, so the protocol never over-credits.
    function wadToUsdg(uint256 amount18) internal pure returns (uint256) {
        return amount18 / USDG_TO_WAD;
    }

    /// @notice WAD to USDG, rounded up. Use this when computing what the protocol is owed.
    function wadToUsdgUp(uint256 amount18) internal pure returns (uint256) {
        return Math.ceilDiv(amount18, USDG_TO_WAD);
    }

    /// @notice Scales an amount with `decimals` decimals to 18 decimals.
    function toWad(uint256 amount, uint8 decimals) internal pure returns (uint256) {
        if (decimals > 36) revert DecimalsTooLarge(decimals);
        if (decimals == 18) return amount;
        if (decimals < 18) return amount * 10 ** (18 - decimals);
        return amount / 10 ** (decimals - 18);
    }

    /// @notice Scales an 18-decimal amount to `decimals` decimals, rounded down.
    function fromWad(uint256 amount18, uint8 decimals) internal pure returns (uint256) {
        if (decimals > 36) revert DecimalsTooLarge(decimals);
        if (decimals == 18) return amount18;
        if (decimals < 18) return amount18 / 10 ** (18 - decimals);
        return amount18 * 10 ** (decimals - 18);
    }

    /// @notice USD value (18 decimals) of `stockRaw` raw Stock Token units at `priceWad` USD per token.
    /// @dev The Chainlink Stock Token price is already total-return / uiMultiplier-aware, so it is a
    ///      price per *raw* token. Applying uiMultiplier here would double count corporate actions.
    function stockValueWad(uint256 stockRaw, uint256 priceWad) internal pure returns (uint256) {
        return Math.mulDiv(stockRaw, priceWad, WAD);
    }

    /// @notice USDG (6 decimals) value of `stockRaw` at `priceWad`, rounded down.
    function stockValueUsdg(uint256 stockRaw, uint256 priceWad) internal pure returns (uint256) {
        return Math.mulDiv(stockRaw, priceWad, WAD * USDG_TO_WAD);
    }
}
