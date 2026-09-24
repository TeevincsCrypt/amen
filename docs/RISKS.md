# Amen Protocol: Risks

This is an unaudited Phase 1 MVP. It is not deployed to mainnet.

## 1. Oracle pause
If a listed Stock Token's `oraclePaused()` returns true, that ticker's mark is **frozen (PAUSED)**:
- no new positions in its markets, and no resolution of them;
- if it's the vault's stock (NVDA in the beta): no vault swaps, and no deposits or withdrawals while the vault holds it.

Other tickers keep working: every mark is per stock. A market that can't resolve within 60 minutes of its resolve time can be voided by anyone, and every stake is refunded 1:1 with no fee. The owner also has a manual freeze, which stops every ticker. Price ≤ 0 and feed errors freeze the mark the same way.

**Listing risk.** Each new ticker is an owner decision: a wrong token or feed address would price that ticker's markets wrongly. `script/check-stock.sh` checks the token's decimals and `uiMultiplier`, and the feed's decimals, description and latest answer, before listing. Only list addresses taken from the official Robinhood and Chainlink pages.

## 2. Stale Sunday feed
Chainlink Stock Token feeds update about 24/5, so a Friday price can still be the latest mark on Sunday.
- **During Vespers** a stale feed is expected and does **not** freeze Amen. But it is never used to settle: resolution needs the first round printed *during the cash session* at or after the resolve time.
- **While the vault holds stock during Vespers**, deposits and withdrawals are locked. Otherwise LPs could trade against a known-stale NAV. LPs exit in USDG after the flatten at the open.
- **At the open**, a feed older than 30 minutes freezes the mark (STALE) until the next print.

## 3. Keeper, 50 bps
Inventory moves are keeper-only and must execute within **50 bps (0.5%)** of the oracle mark and at or above `minOut`. 50 bps is the default and a hard cap: the owner can tighten it but not loosen it. A dishonest keeper can leak up to about 0.5% per trade, and during Vespers the reference mark itself may be stale.

**How the keeper trades** (only once the owner sets a swap adapter and the keeper runs with `VAULT_TRADING=on`): during Vespers it buys the vault's stock only when the pool sells it at least 10 bps below the Chainlink mark, up to 20% of NAV (on-chain `maxInventoryBps` in the beta; the contract allows up to 50%), and sells everything at the open once the mark is fresh.

**The vault can lose money.** A weekend discount is sometimes a gift from an impatient seller, and sometimes the market pricing bad news the stale mark doesn't know yet. In the second case the vault buys exactly when it shouldn't, and Monday's gap costs more than the discount earned. Cycle PnL is the discount plus the weekend move on the inventory, minus pool fees. There's no fixed yield. `script/EnableVaultTrading.s.sol` and the `VAULT_MAX_USDG` keeper cap are there to start with a tiny size.

A shallow pool fails safe: the trade reverts. But until the keeper flattens, withdrawals can't exceed the vault's free USDG. Deploy scripts leave the swap adapter **unset** (swaps disabled) on every chain except local anvil 31337, unless `ADAPTER_ENABLED=true`. The live venue is the NVDA/USDG 0.05% pool `0xd4eb…14a3`. `test/fork/VaultSwapFork.t.sol` executes real swaps against it on a fork (no funds) and must pass before trading is turned on.

## 4. DST and holidays
The session clock computes US DST on-chain (2007+ rule). The owner can pin EDT or EST.
- **Holidays** are an owner/keeper bitmap. The deploy scripts set the next two: 2026-11-26 (Thanksgiving) and 2026-12-25 (Christmas). Later ones must be added by hand.
- **A missed holiday** can't cause a wrong settlement: with no cash-session print, the market voids.
- **Half-days (13:00 close)** aren't modelled. The feed goes stale and the mark freezes, which fails safe.

## 5. Stock Tokens are not shares
Robinhood Stock Tokens are **debt securities** issued by Robinhood Assets (Jersey) Limited. They give economic exposure only, with no share ownership and no voting. Holders carry issuer credit risk.
- Raw `balanceOf` is not a share count. The share-equivalent is `balanceOfUI` = raw × `uiMultiplier`.
- The Chainlink price is already multiplier-aware, so Amen never applies the multiplier to it.

## 6. US persons excluded
Amen isn't available to US persons. Mainnet builds also block US and sanctioned-country IPs from the app (best effort; VPNs exist). There's no US onboarding and no fiat on-ramp. It isn't a broker and gives no investment advice. The UI shows an eligibility attestation and a persistent notice on every page.
