# Mainnet launch runbook: guarded beta

Robinhood Chain mainnet (4663). Everything below is done **by you**, with your wallets. Nobody
else should ever see a private key.

**Beta settings** (`config/launch-4663.json`):

| Setting | Value |
|---|---|
| Vault deposit cap | 10,000 USDG |
| Max size per market | 2,000 USDG |
| Taker fee | 1% |
| Vault inventory swaps | off (no swap adapter) |
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
- [ ] **Live checks.** Run `docs/VERIFY.md`. The fork tests must show 6 passed.
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
forge script script/Deploy.s.sol:DeployMainnet --rpc-url robinhood -vv
rm deployments/4663.json   # the dry run writes simulated addresses; don't keep them
```

It must print `vault deposit cap … 10000000000`, `max notional … 2000000000`, `holidays set: 12`,
`tickers listed: 3` and the `NEXT: from the Safe…` line. It refuses to run if `OWNER` is not a contract or equals
`KEEPER`.

## 3. Deploy

```bash
forge script script/Deploy.s.sol:DeployMainnet --rpc-url robinhood --broadcast \
  --ledger \
  --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
```

(Use `--account <keystore>` or `--private-key` instead of `--ledger` if needed.) The script
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
2. Service **Settings → Config-as-code file path**: `keeper/railway.json`. Otherwise it would
   build the demo chain from the root `railway.json`.
3. **Variables**:
   - `KEEPER_PRIVATE_KEY` = the keeper wallet's key
   - `CHAIN_ID` = `4663`
   - `MARKET_SCHEDULE` = `weekend`
   - `DRY_RUN` = `true` for the first deploy
4. Check the logs: `keeper starting … isKeeperMarket: true`, then quiet ticks. Remove
   `DRY_RUN` to go live.

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
| Missed close (feed outage) | Safe or keeper | `oracle.forceRecordSessionClose(<token>, sessionId, roundId)` (still a Chainlink round) |
| Collect fees | Anyone | `market.claimFees()`, `vault.claimFees()` → sent to the fee recipient |

**Before a normal weekend:** check the keeper log has no `WARN`, and that its ETH balance
covers a week of gas.

## Not in the beta

- **Vault inventory:** no NVDA is bought, because no swap adapter is set. The vault holds USDG
  only until you enable swaps. The vault is single-ticker (NVDA); markets are not.
- **Other market types:** gap markets only from the keeper; no other market kinds.
- **Wallets:** injected wallets only (MetaMask and similar). WalletConnect needs a project id.
