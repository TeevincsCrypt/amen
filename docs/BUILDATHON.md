# Amen: the after-hours venue for Robinhood Stock Tokens

> **Get paid to take the other side of overnight NVDA.**

## Problem
The US cash market trades for 6.5 hours a day on weekdays. Robinhood Stock Tokens keep transferring
and swapping the rest of the time, including nights, weekends and holidays, but nobody is paid to
warehouse that closed-market risk. The spread is wide, there is no counterparty, and the Chainlink
mark sits frozen on Friday's close until Monday. Traders who want to express a view on the Monday
gap have nowhere clean to do it.

## Mechanism
1. **Vespers Vault (NVDA/USDG).** LPs deposit USDG. Only while cash is closed ("Vespers"), a keeper
   may move up to 50% of NAV into NVDA, within 0.5% (50 bps) of the oracle mark. At the open the vault
   flattens back to USDG and the cycle's realized PnL is booked, with a 10% performance fee. While
   inventory is held over a stale weekend mark, LP entry and exit lock so no LP can arbitrage another.
2. **Amen Market.** Parimutuel YES/NO books in USDG on the NVDA weekend or overnight gap:
   "|open/close − 1| ≥ 1%?". The close is the last Chainlink round before the 16:00 NY bell,
   recorded permissionlessly on-chain. The open is the *first* Chainlink print during the cash
   session at or after 09:30 NY, proven round by round so nobody can pick their print.
3. **AmenOracle.** A session clock (NY hours, on-chain DST, holiday bitmap) plus feed guards. It freezes on
   STALE (only while cash is open), PAUSED (`oraclePaused()`), NONPOSITIVE, FEED_ERROR and MANUAL. When
   in doubt Amen **freezes and refunds**: an unresolved market voids after 60 minutes and every stake is refunded 1:1.

## Why only Robinhood Chain
- **Official Stock Tokens** with ERC-8056 corporate-action multipliers. Real instruments, not synthetics.
- **Chainlink Stock Token feeds** that are already total-return aware, so NAV and settlement need no
  custom oracle.
- **USDG** as a native 6-decimal settlement dollar.
- An **FCFS sequencer** with no priority-gas auctions, so the 09:30 open isn't a MEV race.
- The product exists *because* those tokens trade when their underlying market doesn't.

## Demo script (local anvil or a 4663 fork)
```bash
./script/local-demo.sh          # anvil --chain-id 46630 at Fri 15:50 NY → deploy → warp past close
cd frontend && npm i && npm run dev
```
1. **Connect wallet.** The app adds the Robinhood Chain network with its official RPC params (local: anvil 46630).
2. **Session chip** shows **VESPERS** with a countdown to Monday 09:30 America/New_York.
3. **Vespers → Deposit 100 USDG.** NAV = 100.00 USDG (6 dec), and you get 100 vspNVDA shares (18 dec).
4. **Market → Record official close** (permissionless) → **Create** an NVDA gap market, strike 100 bps.
5. **Buy YES** 100 USDG from account #0, and **Buy NO** 300 USDG from account #1.
   (Keeper console: *Start cycle* → *Buy NVDA 40 USDG* to carry overnight inventory.)
6. **Demo controls → Warp to next open.** The **FROZEN · STALE** full-screen banner appears honestly,
   because the feed hasn't printed since Friday. **Push print $182.00** (+1.11%).
7. **Resolve** → YES wins → **Claim** 396 USDG (400 × 0.99). Vespers → **Flatten** → **End cycle**:
   realized PnL is +0.444 USDG, with a 10% perf fee.

Non-goals: no token, no points, no launchpad, no AI agent, no leverage, no proxies, no US persons.
