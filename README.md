# Amen Protocol

The after-hours venue for official Robinhood Stock Tokens, on **Robinhood Chain** (4663 / testnet 46630).

- **Amen Market**: parimutuel gap and absolute-move books in USDG on **every listed Stock Token**
  (NVDA, AAPL, SPY at launch; any Robinhood Stock Token with a Chainlink feed can be added),
  settled on Chainlink with hard freeze rules.
- **Vespers Vault**: a USDG ERC-4626 vault that holds one Stock Token's inventory (NVDA in the
  beta) only while US cash is closed.

> Not for US persons. Stock Tokens are debt securities and give no share ownership. Not advice. Unaudited MVP.

Docs: [SPEC](docs/SPEC.md) · [RISKS](docs/RISKS.md) · [BUILDATHON](docs/BUILDATHON.md) · [LAUNCH (mainnet runbook)](docs/LAUNCH.md) · [VERIFY](docs/VERIFY.md)

## Layout
```
src/AmenOracle.sol        session clock (NY hours, DST, holidays) + Chainlink guards + official closes + ticker registry
src/VespersVault.sol      ERC-4626 USDG vault, session-gated stock inventory (one ticker), cycles, perf fee
src/AmenMarket.sol        GAP_CLOSE_TO_OPEN + ABS_MOVE parimutuel books, deterministic resolve, void
src/adapters/             UniswapV3PoolAdapter (exact-input against the canonical pool)
src/libraries/            DecimalLib, SessionLib, Errors, NetworkGuard
src/mocks/                MockUSDG (6), MockStockToken (uiMultiplier/balanceOfUI/oraclePaused), MockAggregator
script/Deploy.s.sol       DeployLocal (mocks, 31337) · DeployTestnet (mocks, 46630) · DeployMainnet (config/4663.json)
script/RecordClose.s.sol  record the official NVDA close
script/check-stock.sh     check a candidate ticker (token + Chainlink feed) before listing it
script/EnableVaultTrading.s.sol  deploy the vault's Uniswap swap adapter (the Safe then turns trading on)
script/local-demo.sh      one-command local demo (anvil 31337): full flow + summary, then rewinds for the UI
test/unit, test/fork      Foundry tests; fork tests auto-skip unless chainid == 4663
frontend/                 Next.js 14 · wagmi v2 · viem · Tailwind · shadcn-style UI
keeper/                   keeper bot (closes, markets, vault cycles and trading, Telegram/Discord alerts)
```

## Tickers
Amen is not tied to one stock. The oracle keeps a registry of every Stock Token with a feed
(`allStocks()`), and the market accepts any of them the owner allows (`stockAllowed`). The
website, the keeper and the deploy script read that list, so a new ticker needs no code change.

| Ticker | Stock Token | Chainlink feed |
|---|---|---|
| NVDA | `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` | `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15` |
| AAPL | `0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9` | `0x6B22A786bAa607d76728168703a39Ea9C99f2cD0` |
| SPY | `0x117cc2133c37B721F49dE2A7a74833232B3B4C0C` | `0x319724394D3A0e3669269846abE664Cd621f9f6A` |

To add one (addresses from https://docs.robinhood.com/chain/contracts and the Chainlink feed
catalog):

1. `./script/check-stock.sh TSLA <token> <feed>`: every line must pass.
2. **Before the mainnet deploy:** add it to `config/stocks-4663.json`.
   **After:** from the owner Safe, call `oracle.setFeed(<token>, <feed>)` and then
   `market.setStockAllowed(<token>, true)`.

The keeper opens a market for it the next Friday. To delist, call
`market.setStockAllowed(<token>, false)`: open markets still settle, and no new ones are made.
The demo chain lists five mock tickers: NVDA, AAPL, SPY, TSLA and MSFT.

## Contracts
```bash
git submodule update --init --recursive
forge build
forge test                                              # unit + fuzz
forge test --match-path 'test/fork/*' --fork-url $RH_RPC -vv   # live 4663 checks
```

## Local demo
```bash
./script/local-demo.sh                        # anvil 31337 → deploy → full flow → summary → rewind to Fri 16:02 NY
cd frontend && npm install && npm run dev     # http://localhost:3000 (landing) · /app (the same 12 steps as buttons)
```
The app overview (`/app`) runs the flow as anvil dev accounts (owner #0, user1 #1, user2 #2), so no wallet is needed.
*Rewind to Friday 16:02* replays it. Rerun the script for a fresh chain. Needs Foundry and jq.

## Hosted demo (Vercel + Render)
The website runs on Vercel, but Vercel can't run a blockchain. The demo chain (anvil 31337, mocks
only, no real funds) runs as a small Docker service on Render, and the site points at it.

1. **Demo chain on Render:** Render dashboard → **New → Blueprint** → pick this repo. It reads
   `render.yaml` and builds `demo-chain/Dockerfile`, which runs `./script/local-demo.sh --serve`:
   deploy, full scripted flow, then rewind to Friday 16:02 New York. Copy the service URL, e.g.
   `https://amen-demo-chain.onrender.com`.

   **Or on Railway:** New Project → **Deploy from GitHub repo** → pick this repo. `railway.json`
   points it at `demo-chain/Dockerfile`. In the service: **Variables** → add `PORT = 8545`, then
   **Settings → Networking → Generate Domain** with target port **8545**. Copy the
   `https://….up.railway.app` URL.
2. **Site on Vercel:** Project → Settings → **Root Directory = `frontend`** (Framework: Next.js).
   Settings → **Environment Variables**: `NEXT_PUBLIC_RPC_URL = <the Render URL>` for Production
   and Preview. Leave `NEXT_PUBLIC_AMEN_CHAIN` unset (demo chain 31337). **Redeploy**; the
   variable is baked in at build time.

The Render free plan sleeps after about 15 minutes idle. The first visit after that takes about a
minute while it restarts, and a restart resets the chain to Friday 16:02. The chain is public and
shared: anyone can click the demo steps, and *Rewind to Friday 16:02* resets it for everyone. If
the site can't reach the chain, a red banner names the URL it's trying.

## Fork 4663 locally
```bash
anvil --fork-url $RH_RPC            # chain id 4663
forge script script/Deploy.s.sol:DeployMainnet --rpc-url local --private-key $PK --broadcast
NEXT_PUBLIC_AMEN_CHAIN=mainnet NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545 npm run dev
```

## Mainnet (only after verifying every address on Blockscout)
```bash
forge script script/Deploy.s.sol:DeployMainnet --rpc-url robinhood --private-key $PK --broadcast \
  --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
```
The script re-reads `decimals()`, `symbol()`, `uiMultiplier()` and bytecode, and refuses anything but chain 4663.
Addresses are written to `deployments/4663.json`. Then run `cd frontend && npm run sync`.

`deployments/31337.json` holds the deterministic local-anvil addresses (default mnemonic), which are
also hardcoded in `frontend/src/lib/demo.ts`. Deploy scripts leave the vault's swap adapter unset
(swaps disabled) except on 31337, unless `ADAPTER_ENABLED=true`.
