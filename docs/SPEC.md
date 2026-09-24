# Amen Protocol — Phase 1 Specification

Amen Protocol is the after-hours venue for official Robinhood Stock Tokens on
**Robinhood Chain** (chain id 4663, testnet 46630). It has two coupled pieces:

1. **Vespers Vault**: an ERC-4626-style USDG vault that holds NVDA inventory against USDG only
   while the US cash market is closed. LPs earn the closed-market spread, minus a performance fee.
2. **Amen Market**: defined-risk parimutuel event books on NVDA (weekend/overnight gap and
   absolute move). Collateral is USDG. Settlement reads Chainlink with hard freeze rules.

> Pitch: *Get paid to take the other side of overnight NVDA.*

---

## 0. Sources and verification status

The official docs below are the source of truth:

- https://docs.robinhood.com/chain/
- https://docs.robinhood.com/chain/connecting
- https://docs.robinhood.com/chain/stock-tokens/
- https://docs.robinhood.com/chain/building-with-stock-tokens/
- https://docs.robinhood.com/chain/contracts

**Build-environment note:** these docs, the Robinhood RPCs, Blockscout and the Chainlink feed
catalog could not be reached from the sandbox this MVP was written in (egress policy blocked
them). This spec therefore relies on the chain facts in the project brief. Every item marked
**[VERIFY]** has to be re-checked against the live docs and chain before any mainnet
transaction. `test/fork/RobinhoodFork.t.sol` checks the on-chain items automatically when
you run it with `RH_RPC` set.

## 1. Chain facts

| Item | Value |
|---|---|
| Chain ID | 4663 (`0x1237`); testnet 46630 |
| Gas token | ETH, 18 decimals |
| RPC | `https://rpc.mainnet.chain.robinhood.com`; testnet `https://rpc.testnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com`; testnet `https://explorer.testnet.chain.robinhood.com` |
| Stack | Arbitrum Orbit / Nitro, EVM-equivalent. `block.timestamp` is set by the sequencer. |
| Sequencer | FCFS, with no priority gas auctions. Ordering races (resolve vs. void) are decided by arrival order, not by tip. |

Mainnet addresses (see `config/4663.json`). **[VERIFY]** `symbol()`, `decimals()` and bytecode
before use:

| Name | Address | Decimals |
|---|---|---|
| USDG (Paxos Global Dollar) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | **6** |
| NVDA Stock Token | `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` | 18 |
| NVDA/USD Chainlink | `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15` | read `decimals()` live (typically 8) |
| Uniswap V3 Factory | `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` | – |

## 2. Stock Token and oracle pitfalls (read before touching the code)

1. **Stock Tokens are debt securities**, issued by Robinhood Assets (Jersey) Limited. They give
   economic exposure only: no share ownership and no voting. They are **not available to US
   persons**. The UI must never say "own NVDA stock" or "dividends paid in cash".
2. **We never mint or burn them.** Only Authorized Participants can. Amen only transfers and swaps them.
3. **Decimals are 18.** USDG has **6**. Chainlink usually has 8, so we read `feed.decimals()` live
   and never hardcode it.
4. **Corporate actions use ERC-8056, not rebases.** Raw `balanceOf` is *not* a share count.
   Share-equivalent = `raw * uiMultiplier() / 1e18`. The tokens also expose `balanceOfUI(address)`,
   `totalSupplyUI()`, `newUIMultiplier()`, `effectiveAt()` and the event
   `UIMultiplierUpdated(old, new, effectiveAtTimestamp)`.
5. **The Chainlink price is already multiplier-aware (total return per raw token).** Value
   = `raw * price`. **Never multiply the feed price by `uiMultiplier` again.** Amen reads
   `uiMultiplier` only for UI display (share-equivalent), never for valuation.
   `test_UiMultiplierIgnoredInValuation` pins this behaviour.
6. **`oraclePaused()`** is exposed by some tokens. Amen calls it with a low-level `staticcall`,
   so a missing selector means "not paused". If it returns `true`, the mark is **frozen (PAUSED)**.
7. **Feeds run about 24/5, not 24/7.** A stale `updatedAt` over the weekend is expected. Amen
   therefore:
   - freezes on staleness (> 30 min) **only while US cash is open**;
   - does **not** freeze the vault during Vespers just because the feed is stale;
   - never uses a stale weekend mark to settle an event. Settlement needs a round published
     *during the cash session at or after* the market's `resolveEarliestTs` (§5).
8. **The issuer mint/burn window is Mon 02:00 CET to Sat 02:00 CET.** It is irrelevant to Amen.
   Amen keys only off the **US cash session**.
9. **`price <= 0` means frozen (NONPOSITIVE).** A reverting feed means frozen (FEED_ERROR).
10. **USDG is 6 decimals.** If NAV looks 1,000,000× too big, somebody scaled USDG as 18.

## 3. Session clock (`SessionLib` + `AmenOracle`)

- Cash session: Mon–Fri 09:30–16:00 America/New_York. Open is inclusive, close is exclusive.
- **DST strategy:** by default `AUTO` computes US DST on-chain (second Sunday of March 07:00 UTC
  to first Sunday of November 06:00 UTC, the 2007+ Energy Policy Act rule). The owner can pin
  the mode with `setDstMode(FORCE_EDT | FORCE_EST)` (the brief's owner-settable `dstFlag`) if the
  law changes or an emergency needs it. EDT means open 13:30 UTC and close 20:00 UTC. EST means
  14:30 and 21:00 UTC.
- **Holidays:** a bitmap keyed by UTC day index (`timestamp / 86400`). This is the NY calendar
  date for every timestamp inside the session. The owner or a keeper sets holidays. On a holiday
  cash is closed all day, so it is a Vespers day.
- **Half-days** (13:00 ET close) are *not* modelled in Phase 1. The clock treats 13:00–16:00 as
  open. Consequences: the vault refuses to add inventory (safe), and the feed must still be fresh
  or the mark freezes (safe). The owner can also use `setManualFreeze`. Documented in RISKS.md.
- `sessionId` = UTC day index of the trading day whose close it refers to.
- `isVespers()` = `!cashOpen && !manualFreeze`. This is global. Per-stock freeze comes from `getMark`.

## 4. AmenOracle

`getMark(stock)` returns `Mark{priceUsd(1e18), updatedAt, roundId, cashOpen, frozen, freezeReason}`.
When several freeze reasons apply, they take this priority:

`MANUAL` (owner) > `FEED_ERROR` (call reverts or future timestamp) > `PAUSED` (`oraclePaused()`)
> `NONPOSITIVE` > `STALE` (cash open and `now - updatedAt > 30 min`).

`HOLIDAY_OVERRIDE` is emitted when a holiday is set. A holiday closes cash; it does not freeze the mark.

**Official close marks.** `recordSessionClose(stock)` is permissionless. It succeeds only when:
cash is closed now; the most recent trading-day close `C` has not yet been recorded; the latest
round was published in `[C − 30 min, C]`; it is positive; and the token is not paused. That makes
the recorded value the last round at or before the bell. A round published after the bell
(after-hours drift) is refused.

If the feed has already ticked after the close, use `recordSessionCloseAtRound(stock, roundId)`
instead. It is also permissionless and proves that `roundId` is the last round at or before `C`:
its successor `roundId+1` either doesn't exist or was published after `C`.

The owner or a keeper can `forceRecordSessionClose(stock, sessionId, roundId)`. This still reads
the price from Chainlink, because **the owner can never type a price**. Recorded closes are
immutable.

## 5. AmenMarket rules

Both market kinds are parimutuel binaries on USDG. **Conservative interpretations are marked (C).**

- **GAP_CLOSE_TO_OPEN.** Created from `officialClose(stock, sessionId)`, which must already be
  recorded. `resolveEarliestTs` = the next cash open after that close, computed on-chain.
  YES ⇔ `|open/close − 1| ≥ strikeBps` (absolute gap).
- **ABS_MOVE.** Reference = an official close (`sessionId`) or, when `sessionId == 0`, the live
  mark at creation, which must be cash-open and unfrozen. `resolveEarliestTs` is chosen by the
  creator and must fall inside a cash session. YES ⇔ `|mark_resolve/ref − 1| ≥ strikeBps`.
  **(C)** "By resolve time" means **at** the resolve mark (point-in-time), not "touched at any
  point before". A touch can't be proven from Chainlink rounds on-chain.
- **Resolve mark (C).** This is the *first* Chainlink round with `updatedAt ≥ resolveEarliestTs`,
  proven by showing that round `roundId−1` was before it. So the result does not depend on
  *when* someone calls `resolve`. `resolve(id)` finds that round by walking back from the latest
  one (bounded). `resolve(id, roundId)` takes it explicitly. The round must also be published
  while cash is open.
- **Resolve preconditions:** `resolveEarliestTs ≤ now ≤ resolveEarliestTs + 60 min`; the
  current mark is not frozen (no PAUSED, NONPOSITIVE, STALE or MANUAL); cash is open
  (`isVespers() == false`).
- **Void (C):** if the market is not resolved within 60 min of `resolveEarliestTs`, anyone may
  `void`. Everyone then gets collateral back 1:1 and no fee is charged. A market is also voided
  **at resolve** if either pool is zero (no counterparty), so nobody pays a fee to win their
  own money back.
- **Trading:** only in `[startTs, endTs)`, `endTs ≤ resolveEarliestTs`, and only while the mark
  is not frozen. Each market has a `maxNotional` cap. The vault never trades into markets in
  Phase 1.
- **Payout:** `stake × (yesPool + noPool) × (1 − takerFeeBps) / winningPool`, rounded down.
  The fee accrues to `feeRecipient` and is pulled, never pushed, so a USDG-frozen fee address
  cannot block `resolve`. Rounding dust stays in the contract.
- **Creation** is by the owner or a keeper only. Only allow-listed stocks are accepted
  (Phase 1: NVDA).

## 6. VespersVault rules

- ERC-4626 on USDG. `_decimalsOffset = 12`, so shares have 18 decimals, which blunts the
  first-depositor inflation attack.
- `totalAssets = USDG balance − accrued fees + stockRaw × mark.priceUsd / 1e18`, scaled to
  6 decimals and rounded **down**. No `uiMultiplier` is applied.
- **Deposit and withdraw gating (C):**
  - Flat vault (no NVDA): allowed, except during a cash-open freeze (spec lock).
  - NVDA held and cash open: allowed only when the mark is fresh and unfrozen. A withdrawal that
    needs more USDG than the vault holds reverts `CashOpenFlattenRequired` (the keeper must
    flatten first).
  - NVDA held during Vespers: **locked** (`VespersInventoryLocked`). The weekend mark is stale,
    so allowing entry or exit would let an LP arbitrage other LPs against a known-stale NAV.
    Liquidity exits at the next flatten. With `allowInKind` (default false), `redeemInKind` pays
    pro-rata USDG + NVDA, which needs no oracle.
  - Any frozen mark while NVDA is held: locked (`OracleFrozen`).
- **Inventory:** only a keeper can trade, and only through the owner-set `ISwapAdapter`.
  - `buyInventory`: only during `isVespers()`, with an unfrozen mark, and while
    post-trade NVDA value ≤ `maxInventoryBps` (default 50%) of NAV.
  - `sellInventory` (flatten): allowed in any session while the mark is unfrozen.
  - Both check the execution price against the oracle mark (`maxDeviationBps`, default and hard cap 50 bps = 0.5%) and
    the caller's `minOut`.
- **Guarded launch:** `depositCap` (owner-set, default uncapped) limits NAV after a deposit.
  ERC-4626 `maxDeposit`/`maxMint` report the remaining room. Withdrawals are never capped.
- **Cycles:** `startCycle()` can be called by anyone during Vespers. `endCycle()` can be called
  by anyone once cash is open and the vault is flat.
  `realizedPnl = navEnd − navStart − netFlows` (deposits minus withdrawals inside the cycle).
  On positive PnL, `perfFeeBps` (default 10%) accrues as USDG to `feeRecipient` and is pulled.
  `mgmtFeeBps` is 0 and unused in Phase 1.
- Phase 1 has no reserve against AmenMarket exposure, because the vault does not underwrite markets.

## 7. Network guard

Every core contract reverts at construction unless `block.chainid ∈ {4663, 46630, 31337}`. 31337
is local anvil only (no real funds), used by `script/local-demo.sh`. Deploy scripts leave the vault's
swap adapter unset on every chain except 31337, unless `ADAPTER_ENABLED=true`.

## 8. Explicit non-goals

No token, points, airdrop, launchpad, AI agent, leverage, proxies, US onboarding, fiat, Pendle
split or Uniswap fork. No ETH/USD feed is assumed.
