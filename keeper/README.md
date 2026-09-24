# Amen keeper

Runs Amen's routine, time-driven jobs every `INTERVAL_SEC` (30 s):

1. **Record the official close** after the 16:00 New York bell: the last Chainlink round at or
   before the bell, within 30 minutes. Uses `recordSessionCloseAtRound` if the feed already
   ticked after the bell. If the last pre-bell round is older than 30 minutes, it only warns;
   forcing a close is left to a human.
2. **Create a gap market for every listed ticker** for that close (`MARKET_SCHEDULE=weekend`:
   only when the next open is a day or more away), with `STRIKE_BPS` and a notional capped at
   the contract's `maxNotionalLimit`. Tickers are read from the chain each tick
   (`oracle.allStocks()` filtered by `market.stockAllowed`), so a ticker listed from the Safe is
   picked up without a restart. The close is recorded for each ticker too.
3. **Resolve** each market with the first cash-session round at or after its resolve time
   (`resolveWithRound`, so it never depends on scan limits), or **void** it once the 60-minute
   window has passed so stakes can be refunded.
4. **Vault cycle books:** start a cycle at the close when flat; at the open, flatten (only if a
   swap adapter is set) and end the cycle.
5. **Vault trading** (only with `VAULT_TRADING=on` and a swap adapter set by the owner): during
   Vespers, buy the vault's stock when the pool sells it at least `VAULT_MIN_EDGE_BPS` below the
   Chainlink mark, one chunk per tick, up to `VAULT_TARGET_BPS` of NAV (and `VAULT_MAX_USDG`).
   No buys in the last `VAULT_BUY_CUTOFF_MIN` minutes before the open. At the open, once the
   mark is fresh, sell everything (in halves if a full sell would miss the 50 bps band).
6. **Alerts** to Telegram and/or Discord: warnings, errors, low gas and (at `ALERT_LEVEL=info`)
   every transaction, each with an explorer link. The same alert repeats at most every 6 hours.

Every write is simulated first and skipped if it would revert. The keeper wallet needs only
keeper rights and a little ETH for gas. It can't set prices or move user funds.

## Environment

| Variable | Default | Notes |
|---|---|---|
| `KEEPER_PRIVATE_KEY` | required | The keeper wallet. Never the owner Safe. |
| `CHAIN_ID` | `4663` | Must match the RPC. |
| `RPC_URL` | Robinhood mainnet RPC | Alchemy etc. also fine. |
| `MARKET_SCHEDULE` | `weekend` | `weekend`, `daily` or `off`. |
| `STRIKE_BPS` | `100` | 1.00% gap. |
| `MARKET_NOTIONAL_USDG` | contract limit | Per-market cap, never above `maxNotionalLimit`. |
| `MARKET_TICKERS` | all listed | Optional comma list, e.g. `NVDA,AAPL`, to open markets for only those tickers. Closes are still recorded and markets still resolved for all. |
| `VAULT_CYCLES` | `on` | Set `off` to skip vault bookkeeping. |
| `VAULT_TRADING` | `off` | `on`: buy stock in Vespers at a discount, sell at the open. Needs a swap adapter. |
| `VAULT_TARGET_BPS` | `2000` | Target inventory, % of NAV (the contract's `maxInventoryBps` caps it too). |
| `VAULT_MAX_USDG` | unset | Absolute cap on inventory value, e.g. `50` for a first live weekend. |
| `VAULT_CHUNK_USDG` | `100` | Max USDG per buy. |
| `VAULT_MIN_EDGE_BPS` | `10` | Buy only this many bps below the mark. |
| `VAULT_BUY_CUTOFF_MIN` | `60` | No buys this close to the open. |
| `ALERT_TELEGRAM_BOT_TOKEN` `ALERT_TELEGRAM_CHAT_ID` | unset | Telegram alerts (see `docs/LAUNCH.md` step 6). |
| `ALERT_DISCORD_WEBHOOK` | unset | Discord alerts. |
| `ALERT_LEVEL` | `info` | `info`: every transaction plus problems. `warn`: problems only. |
| `LOW_ETH_ALERT` | `0.002` | Warn when the keeper wallet has less ETH than this. |
| `DRY_RUN` | `false` | `true`: read and simulate only, send nothing. |
| `PORT` | unset | If set, serves a JSON health/status endpoint. |
| `ORACLE` `MARKET` `VAULT` | from `deployments/<CHAIN_ID>.json` | Optional overrides. |

## Run

```bash
cd keeper && npm ci
DRY_RUN=true node src/keeper.mjs --once                        # mainnet, simulate one tick
KEEPER_PRIVATE_KEY=0x… node src/keeper.mjs                      # mainnet, run forever
CHAIN_ID=31337 RPC_URL=http://127.0.0.1:8545 KEEPER_PRIVATE_KEY=0xac09…ff80 node src/keeper.mjs --once   # local demo chain
```

On Railway, add a second service from this repo, and under Settings set **Config-as-code
file** to `keeper/railway.json`. See `docs/LAUNCH.md`.
