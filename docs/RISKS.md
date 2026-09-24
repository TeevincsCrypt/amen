# Amen Protocol: Risks

Phase 1 is an MVP. It is **unaudited**, and it is **not for US persons**. Nothing in it is investment advice.

## 1. Instrument and legal risk

- **Stock Tokens are debt securities** issued by Robinhood Assets (Jersey) Limited. They give economic
  exposure only, with no share ownership and no voting rights. Holders take issuer credit risk.
- **Not available to US persons.** Amen has no US onboarding, no fiat on-ramp, and is not a broker.
  The UI shows an eligibility attestation and a persistent notice.
- Only Authorized Participants mint or burn Stock Tokens. Amen never does, so vault liquidity
  depends on secondary venues (AMM/RFQ).
- **USDG** is issued by Paxos. It can be frozen by its issuer, and a frozen address can't receive
  payouts. Fees are *pulled* (`claimFees`), so a frozen fee recipient can't block resolution or cycles.

## 2. Oracle risk

| Risk | Handling |
|---|---|
| Feed stale while cash is open (> 30 min) | Mark frozen `STALE`. No swaps, no new positions, no resolution. Deposits and withdrawals lock. |
| Feed stale during Vespers (weekend or overnight) | **Expected**, so not frozen. The stale mark is still never used to settle an event. |
| `oraclePaused()` returns true | Mark frozen `PAUSED`. Markets can't resolve and void after 60 min. |
| `price <= 0` | Mark frozen `NONPOSITIVE`. |
| Feed call reverts, or returns a timestamp of 0 or in the future | Mark frozen `FEED_ERROR`. |
| Corporate action (ERC-8056 multiplier change) | The Chainlink price is already multiplier-aware, and Amen never applies `uiMultiplier` to it (pinned by tests). |
| Wrong feed registered | Only the owner can register a feed. `decimals()` is read live. The fork test compares against real bytecode. **[VERIFY]** the feed catalog before mainnet. |
| Owner price manipulation | Impossible by design: official closes are always Chainlink rounds, even when forced. |

## 3. Session-clock risk

- **DST** is computed on-chain (US 2007+ rule). The owner can pin EDT or EST if the law changes.
- **Holidays** are an owner/keeper-maintained bitmap. A missed holiday can't mis-settle a
  market: on that day nobody publishes a cash-session round, so the market voids. The vault would
  also treat the day as cash-open, which blocks new inventory (conservative).
- **Half-days** (13:00 ET close) are *not modelled*. From 13:00 to 16:00 the clock says "open". The mark
  then goes stale and freezes, which is conservative. Operators can use `setManualFreeze`.
- `block.timestamp` is set by the Nitro sequencer. Seconds-level skew around the bell is possible.
  That's why closes use a 30-min lookback and gap resolution uses "first round at or after the open".

## 4. Vespers Vault risk

- **Gap risk is the product.** The vault can hold up to `maxInventoryBps` (50%) of NAV in NVDA
  across the close. An adverse open gap is a direct LP loss.
- **Stale NAV arbitrage** is mitigated. While stock is held during Vespers, deposits and withdrawals
  lock (`VespersInventoryLocked`). Otherwise an LP who saw off-chain overnight prices could enter or
  exit against a known-stale NAV. LPs exit in USDG at the next flatten. In-kind exit is available
  only if the owner enables `allowInKind`.
- **Keeper execution risk.** Swaps must be within `maxDeviationBps` (5%) of the oracle mark and at
  or above the keeper's `minOut`. During Vespers, the mark used for that bound may itself be stale.
  A dishonest keeper could leak up to about 5% per trade: that's the trust assumption on keepers
  in Phase 1.
- **Liquidity risk.** If the NVDA/USDG pool is shallow, flattening at the open may fail the
  deviation bound, and withdrawals then revert `CashOpenFlattenRequired` until it succeeds.
- **Stock donations** are ignored. Inventory is tracked internally, so nobody can grief the vault into a locked state.
- **Inflation attack** is mitigated with ERC-4626 `_decimalsOffset = 12`.
- Cycle PnL is exact only when entered and exited flat. `redeemInKind` during a cycle values the
  stock leg at the current (possibly stale) mark for the flow adjustment.

## 5. Amen Market risk

- Parimutuel: you can lose your entire stake, and the payout multiple changes until trading ends.
- **Settlement is deterministic.** It uses the *first* Chainlink round printed at or after
  `resolveEarliestTs`, proven via its predecessor. The resolver can't pick a favourable later print.
- **Void rule.** If the market isn't resolved within 60 minutes of `resolveEarliestTs` (stale feed,
  pause, holiday, or nobody called resolve), anyone may void it, and everyone gets stakes back 1:1
  with no fee. **Liveness caveat:** winners must call `resolve` inside that hour, or the market
  voids. That's conservative by design.
- **One-sided markets** void at resolution. Nobody pays a fee to win back their own money.
- **Information asymmetry.** Overnight venues and 24/5 feed updates leak information during
  trading. Trading ends at the open, and `maxNotional` caps exposure.
- **FCFS sequencer.** A `resolve` and a `voidMarket` can't both be valid at the same time, because their time
  windows don't overlap. So there's no ordering race between them.
- Rounding dust (at most one USDG unit per winner) stays in the contract.

## 6. Smart contract and admin risk

- No proxies, and constructor-set owners with `Ownable2Step`. The owner can freeze the protocol,
  register feeds, set holidays and DST mode, set fees (capped: perf ≤ 30%, taker ≤ 5%) and the swap adapter,
  and grant keepers.
- The owner **cannot** move user funds, set a price or alter a market after creation (the fee is
  snapshotted per market).
- `ReentrancyGuard` protects every state-changing vault and market entry point, and the tests
  cover reentrant tokens.
- Unaudited. The Uniswap V3 adapter has only been tested against a fake pool; run the fork tests
  against the real pool before use.

## 7. Items to verify before mainnet

1. `symbol()`, `decimals()` and bytecode for USDG, NVDA and the NVDA/USD feed on Blockscout
   (`forge test --match-path 'test/fork/*' --fork-url $RH_RPC -vv` prints them).
2. Whether NVDA exposes `oraclePaused()`.
3. That the NVDA/USD feed's `getRoundData(roundId − 1)` works within a phase. Resolution relies on it.
4. That an NVDA/USDG Uniswap V3 pool and fee tier exist (`config/4663.json: uniswapFeeTier`).
5. The 2026/2027 NYSE holiday calendar, loaded via `setHoliday`.
