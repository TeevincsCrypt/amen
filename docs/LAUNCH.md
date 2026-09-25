# Mainnet launch runbook: guarded beta

Robinhood Chain mainnet (4663). Everything below is done **by you**, with your wallets. Nobody
else should ever see a private key.

**Beta settings** (`config/launch-4663.json`):

| Setting | Value |
|---|---|
| Vault deposit cap | 10,000 USDG |
| Max size per market | 2,000 USDG |
| Taker fee | 1% |
| Vault inventory swaps | off until you turn them on (step 9) |
| NYSE holidays loaded | 2026-11-26 → 2027-12-24 |
| Tickers listed | NVDA, AAPL, SPY (`config/stocks-4663.json`) |
| Vault stock | NVDA only |

**Roles**:

| Role | Who | Can do |
|---|---|---|
| Owner | Your **Safe** multisig | Freeze, set holidays, change caps and fees, grant keepers |
| Keeper | A separate hot wallet, used by the bot | Record closes, create markets, move vault inventory (off in beta) |
| Deployer | Any funded wallet | Deploys, then holds no rights once the Safe accepts ownership |

---

## 0. Before you start (not code)

- [ ] **Legal review.** The gap markets are effectively binary options on a security. The EU bans
  selling binary options to retail customers, and Robinhood Stock Tokens aren't available to US
  persons. Get written advice on which countries you may serve. Add any extra blocked countries
  with `GEOBLOCK_EXTRA` (step 7), with no code change.
- [ ] **Audit.** The contracts are unaudited. The caps limit the damage from a bug; they don't
  prevent one. Plan an audit before raising the caps.
- [ ] **Holidays.** Check the list in `config/launch-4663.json` against
  https://www.nyse.com/markets/hours-calendars.
- [ ] **Live checks.** Run `docs/VERIFY.md`. The fork tests must show 9 passed.
- [ ] **Tickers.** For each entry in `config/stocks-4663.json`, run
  `./script/check-stock.sh <SYMBOL> <token> <feed>`. Every line must pass. Remove any that don't.

## 1. Wallets

1. **Safe:** create a Safe on Robinhood Chain (for example 2-of-3) at https://app.safe.global.
   If Safe doesn't support chain 4663, stop and tell me; we'll choose another multisig. Don't
   fall back to a single wallet without deciding that explicitly (`ALLOW_EOA_OWNER=true`).
2. **Keeper wallet:** create a **new** wallet used only by the bot. Send it a little ETH on
   Robinhood Chain for gas. It must not be one of the Safe's signers.
3. **Deployer:** any wallet with some ETH on Robinhood Chain. A hardware wallet (`--ledger`) or
   an encrypted keystore (`--account`) is better than pasting a private key.

## 2. Dry run (sends nothing)

```bash
git pull && git submodule update --init --recursive
export OWNER=0xYourSafe KEEPER=0xYourKeeperWallet
forge script script/Deploy.s.sol:DeployMainnet --rpc-url robinhood \
  --account deployer --sender 0xYourDeployerAddress -vv
rm deployments/4663.json   # the dry run writes simulated addresses; don't keep them
```

It must print `vault deposit cap … 10000000000`, `max notional … 2000000000`, `holidays set: 12`,
`tickers listed: 3` and the `NEXT: from the Safe…` line. It refuses to run if `OWNER` is not a contract or equals
`KEEPER`.

## 3. Deploy

```bash
forge script script/Deploy.s.sol:DeployMainnet --rpc-url robinhood --broadcast \
  --account deployer --sender 0xYourDeployerAddress \
  --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
```

(`--sender` must be the deployer wallet's address: the script uses it as the temporary owner until the Safe accepts. With a Ledger, use `--ledger --sender <ledger address>` instead of `--account`.) The script
checks every setting after deploying and writes `deployments/4663.json`.

## 4. Hand ownership to the Safe

In the Safe app → **Transaction Builder**, add three calls, each with no arguments:
`acceptOwnership()` on the `oracle`, `vault` and `market` addresses from
`deployments/4663.json`. Execute the batch.

Check: `cast call <vault> "owner()(address)" --rpc-url robinhood` returns the Safe.

## 5. Publish the addresses

```bash
cd frontend && npm run sync && cd ..
git add deployments/4663.json frontend/src/lib/deployments.json
git commit -m "Mainnet guarded-beta deployment" && git push
```

## 6. Keeper bot on Railway

1. Railway → your project → **New → GitHub Repo** → `TeevincsCrypt/amen` (a second service).
2. The repo's image runs the demo chain by default. The variable `AMEN_SERVICE=keeper` (below)
   makes this service run the keeper instead. No config-file setting needed.
3. **Variables**:
   - `AMEN_SERVICE` = `keeper`
   - `KEEPER_PRIVATE_KEY` = the keeper wallet's key
   - `CHAIN_ID` = `4663`
   - `MARKET_SCHEDULE` = `weekend`
   - `DRY_RUN` = `true` for the first deploy
   - **Alerts** (optional, recommended): Telegram or Discord, or both.
     - Telegram: message **@BotFather** → `/newbot` → copy the token into
       `ALERT_TELEGRAM_BOT_TOKEN`. Send your new bot any message, then open
       `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `"chat":{"id":…}` into
       `ALERT_TELEGRAM_CHAT_ID`.
     - Discord: Server settings → **Integrations → Webhooks → New Webhook** → copy the URL into
       `ALERT_DISCORD_WEBHOOK`.
     - `ALERT_LEVEL` = `info` (every transaction plus problems) or `warn` (problems only).
4. Check the logs: `keeper starting … isKeeperMarket: true`, then quiet ticks. With alerts set
   you get a "Keeper started" message. Remove `DRY_RUN` to go live.

You're alerted on: warnings (a market about to void, a missing close), errors, the keeper
wallet dropping below 0.002 ETH (`LOW_ETH_ALERT`), and, at `info`, every transaction. An alert
can't tell you the keeper has stopped entirely: for that, set `PORT` = `8080`, give the service a
Railway domain, and point a free uptime monitor (UptimeRobot, Better Stack) at it.

What it does each week: after Friday's 16:00 New York bell it records the close and opens the
weekend market for every listed ticker (or only those in `MARKET_TICKERS`, e.g. `NVDA,AAPL`). At Monday's open it resolves the market with the first print at or after 09:30,
or voids it after 60 minutes so everyone can claim a refund.

## 7. Two websites on Vercel

1. **Demo site:** Vercel → **Add New → Project** → same repo, Root Directory `frontend`.
   Variable `NEXT_PUBLIC_RPC_URL` = your Railway demo-chain URL. Note its URL.
2. **Main site** (your existing project) → **Settings → Environment Variables**:
   - `NEXT_PUBLIC_AMEN_CHAIN` = `mainnet`
   - `NEXT_PUBLIC_DEMO_URL` = the demo site's URL
   - Delete `NEXT_PUBLIC_RPC_URL`, or set it to an Alchemy Robinhood URL for better limits.
   - Optional: `GEOBLOCK_EXTRA` = extra country codes from your legal review, e.g. `DE,FR`.
   - Recommended: `NEXT_PUBLIC_WC_PROJECT_ID` = a free project ID from https://cloud.reown.com
     (sign up → **Create project** → copy the Project ID). It turns on **WalletConnect**, so
     people can connect a phone wallet by scanning a QR code. In the Reown project, add your
     site's domain under **Domain** (allowlist).

   Then **Redeploy**.

Check: the site shows **Robinhood Chain · 4663 · Guarded beta**, and the Vault shows
**Beta deposit cap 0 / 10,000**. Opening `/app` through a US VPN redirects to "not available in
your region".

## 8. Operating it

| Need | Who | Call |
|---|---|---|
| Emergency stop | Safe | `oracle.setManualFreeze(true)` (later `false`) |
| Raise the vault cap | Safe | `vault.setDepositCap(<USDG × 1e6>)` |
| Raise the market cap / fee | Safe | `market.setFeeParams(<feeRecipient>, <feeBps>, <maxNotional × 1e6>)` |
| Add a holiday | Safe or keeper | `oracle.setHoliday(<unix day = timestamp / 86400>, true)` |
| Rotate the keeper | Safe | `setKeeper(old, false)` and `setKeeper(new, true)` on oracle, vault and market |
| List a ticker | Safe | run `script/check-stock.sh` first, then `oracle.setFeed(<token>, <feed>)` and `market.setStockAllowed(<token>, true)` |
| Delist a ticker | Safe | `market.setStockAllowed(<token>, false)` (open markets still settle) |
| Turn vault trading off | Keeper env, then Safe | `VAULT_TRADING=off`; once the vault is flat, `vault.setSwapAdapter(0x0000000000000000000000000000000000000000)` |
| Change the vault inventory cap | Safe | `vault.setParams(<bps of NAV>, 1000, 50, false)` (max 5000 = 50%) |
| Missed close (feed outage) | Safe or keeper | `oracle.forceRecordSessionClose(<token>, sessionId, roundId)` (still a Chainlink round) |
| Collect fees | Anyone | `market.claimFees()`, `vault.claimFees()` → sent to the fee recipient |

**Before a normal weekend:** check the keeper log has no `WARN`, and that its ETH balance
covers a week of gas.

## 9. Turn on vault trading (after a few quiet weekends)

Until this step the vault holds USDG only and earns nothing. With trading on, the keeper buys
NVDA during Vespers **only when the pool sells it below the Chainlink mark** (by at least
`VAULT_MIN_EDGE_BPS`, 0.10% by default), and sells it all at Monday's open once the first print
arrives. The vault gains the discount plus NVDA's weekend move, and loses if NVDA gaps down by
more than the discount. There is no fixed yield: read `docs/RISKS.md` §3 first.

1. **Test the real pool, with no money** (Git Bash, from the repo):
   ```bash
   forge test --match-contract VaultSwapForkTest --fork-url https://rpc.mainnet.chain.robinhood.com -vv
   ```
   It must show `2 passed`. Read the log: `within the vault's 50 bps band: true` for 10 and 100
   USDG, and a `round-trip cost` under about 60 bps. If the pool is too shallow, stop here.
2. **Deploy the swap adapter** (dry run first, then for real):
   ```bash
   forge script script/EnableVaultTrading.s.sol --rpc-url robinhood -vv
   forge script script/EnableVaultTrading.s.sol --rpc-url robinhood --broadcast --ledger \
     --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
   ```
   It prints the two Safe calls and records the adapter in `deployments/4663.json`.
3. **From the Safe**, on the `vault`: `setParams(2000, 1000, 50, false)` (inventory at most 20%
   of NAV), then `setSwapAdapter(<adapter>)`. Commit and push `deployments/4663.json`.
4. **Keeper variables** on Railway, for a tiny first weekend:
   `VAULT_TRADING` = `on`, `VAULT_MAX_USDG` = `50`, `VAULT_CHUNK_USDG` = `25`.
5. **Watch the weekend:** buys only show up with a discount; on Monday you get "sell all
   stock" after the first print, then "end cycle". The Vault page shows the cycle's PnL under
   **Cycle history**.
6. Raise `VAULT_MAX_USDG` slowly, weekend by weekend. Remove it to use the full 20%.

## Not in the beta

- **Vault inventory:** off until step 9. The vault is single-ticker (NVDA); markets are not.
- **Other market types:** gap markets only from the keeper; no other market kinds.
- **Wallets:** browser extensions (MetaMask, Rabby…) and, with `NEXT_PUBLIC_WC_PROJECT_ID` set,
  phone wallets through WalletConnect. The phone wallet must support Robinhood Chain (4663) or
  let the site add it.
