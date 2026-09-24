# Amen: the after-hours venue for Robinhood Stock Tokens

**Amen lets LPs and traders get paid to take the other side of overnight NVDA:** a USDG vault that carries NVDA only while US cash is closed, plus defined-risk gap markets settled on Chainlink.

## Why only Robinhood Chain
- **The tokens trade 24/7:** official NVDA Stock Tokens transfer and swap on nights and weekends, while the US cash market doesn't.
- **The feeds update 24/5:** Chainlink Stock Token feeds follow market hours, so the weekend mark is stale by design. Amen is built around that gap.
- **Official NVDA:** the real issuer token (ERC-8056 multiplier), a multiplier-aware feed, and USDG settlement, all native. The FCFS sequencer means no gas auction at the open.

## How the close is recorded
After 16:00 New York, anyone calls `recordSessionClose`. It stores the last Chainlink round published in [16:00 − 30 min, 16:00]. Rounds printed after the bell are rejected. If the feed has already ticked after the bell, `recordSessionCloseAtRound` proves a given round was the last one before 16:00. Even the owner's forced record reads a Chainlink round, so nobody can type a price.

## Why resolve can't shop rounds
The market settles on the **first** round published at or after 09:30, and it must be printed during the cash session. `resolve` proves it by showing round `id − 1` came before 09:30. Later prints and pre-market prints are rejected, so the outcome doesn't depend on who calls or when.

## Why we void
If there's no valid resolve within 60 minutes of the open (stale feed, `oraclePaused()`, holiday, or nobody called), anyone can void, and every stake is refunded 1:1 with no fee. A market with an empty side also voids. Amen prefers a refund to a guess.

## Why the vault locks while holding NVDA
Over a weekend the NAV prices NVDA at a stale mark. If LPs could enter or exit then, anyone who saw overnight prices elsewhere could trade against the other LPs. So deposits and withdrawals pause while the vault holds NVDA during Vespers, and reopen in USDG after the flatten at the open. Keeper swaps must land within 50 bps of the oracle mark.

## Run the demo
```bash
./script/local-demo.sh                         # anvil 31337: deploy → full flow → one-screen summary → rewind to Fri 16:02
cd frontend && npm install && npm run dev      # http://localhost:3000/app : the same 12 steps as buttons, no wallet needed
```
The flow: record close → 1% gap market → user1 YES 100 / user2 NO 300 → vault takes 40 USDG of NVDA → Monday 09:45 print $182 → resolve → user1 claims 396 USDG → flatten → cycle PnL +0.444 USDG.

## Not shipped
No token, no points, no mainnet deployment, no AAPL or SPY, no second market kind in the demo, no US persons, no leverage, no proxies.
