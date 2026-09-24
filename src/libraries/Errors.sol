// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Errors
/// @notice Every revert in Amen Protocol is one of these custom errors. There are no string reverts.
library Errors {
    // ── network / access ──────────────────────────────────────────────
    error WrongChain(uint256 chainId);
    error NotKeeper(address caller);
    error ZeroAddress();
    error InvalidParam();

    // ── oracle / session ──────────────────────────────────────────────
    error UnknownStock(address stockToken);
    error CashOpen();
    error CashClosed();
    error AlreadyRecorded(address stockToken, uint256 sessionId);
    error CloseNotRecorded(address stockToken, uint256 sessionId);
    error RoundOutsideCloseWindow(uint80 roundId, uint256 updatedAt, uint256 closeTs);
    error RoundNotLastBeforeClose(uint80 roundId);
    error BadRound(uint80 roundId);
    error OracleFrozen(bytes32 reason);
    error NoRecentClose();

    // ── vault ─────────────────────────────────────────────────────────
    error CashOpenFlattenRequired();
    error VespersInventoryLocked();
    error NotVespers();
    error InventoryCapExceeded(uint256 stockValueUsdg, uint256 capUsdg);
    error PriceDeviation(uint256 execPrice, uint256 markPrice);
    error Slippage(uint256 out, uint256 minOut);
    error NoSwapAdapter();
    error CycleActive();
    error NoActiveCycle();
    error NotFlat();
    error InKindDisabled();
    error NothingToClaim();

    // ── market ────────────────────────────────────────────────────────
    error StockNotAllowed(address stockToken);
    error UnknownMarket(uint256 marketId);
    error TradingClosed(uint256 marketId);
    error MaxNotionalExceeded(uint256 marketId);
    error ZeroAmount();
    error AlreadySettled(uint256 marketId);
    error NotSettled(uint256 marketId);
    error TooEarly(uint256 nowTs, uint256 earliestTs);
    error ResolveWindowOver(uint256 marketId);
    error VoidNotYetAllowed(uint256 marketId);
    error ResolveRoundNotFound(uint256 marketId);
    error ResolveRoundInvalid(uint80 roundId);
    error AlreadyClaimed(uint256 marketId, address user);
}
