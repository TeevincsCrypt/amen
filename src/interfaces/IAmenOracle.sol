// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The only price/session surface the rest of Amen trusts.
interface IAmenOracle {
    struct Mark {
        uint256 priceUsd; // 18 decimals, per raw Stock Token (already multiplier-aware)
        uint256 updatedAt;
        uint80 roundId;
        bool cashOpen;
        bool frozen;
        bytes32 freezeReason; // STALE, PAUSED, NONPOSITIVE, FEED_ERROR, MANUAL (HOLIDAY_OVERRIDE is a session event, not a freeze)
    }

    function getMark(address stockToken) external view returns (Mark memory);
    function isVespers() external view returns (bool);
    function isCashOpen() external view returns (bool);
    function isCashOpenAt(uint256 ts) external view returns (bool);
    function manualFreeze() external view returns (bool);
    function recordSessionClose(address stockToken) external;
    function officialClose(address stockToken, uint256 sessionId) external view returns (Mark memory);
    function sessionCloseTs(uint256 sessionId) external view returns (uint256);
    function nextOpenAfter(uint256 ts) external view returns (uint256);
    function getRoundMark(address stockToken, uint80 roundId)
        external
        view
        returns (bool ok, uint256 priceUsd, uint256 updatedAt);
    function isStockPaused(address stockToken) external view returns (bool);
}
