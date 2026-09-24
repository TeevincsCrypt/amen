# Amen Protocol

The after-hours venue for official Robinhood Stock Tokens, on **Robinhood Chain** (4663 / testnet 46630).

- **Vespers Vault**: a USDG ERC-4626 vault that holds NVDA inventory only while US cash is closed.
- **Amen Market**: parimutuel NVDA gap and absolute-move books in USDG, settled on Chainlink with hard freeze rules.

> Not for US persons. Stock Tokens are debt securities and give no share ownership. Not advice. Unaudited MVP.

Docs: [SPEC](docs/SPEC.md) · [RISKS](docs/RISKS.md) · [BUILDATHON](docs/BUILDATHON.md)

## Layout
```
src/AmenOracle.sol        session clock (NY hours, DST, holidays) + Chainlink guards + official closes
src/VespersVault.sol      ERC-4626 USDG vault, session-gated NVDA inventory, cycles, perf fee
src/AmenMarket.sol        GAP_CLOSE_TO_OPEN + ABS_MOVE parimutuel books, deterministic resolve, void
src/adapters/             UniswapV3PoolAdapter (exact-input against the canonical pool)
src/libraries/            DecimalLib, SessionLib, Errors, NetworkGuard
src/mocks/                MockUSDG (6), MockStockToken (uiMultiplier/balanceOfUI/oraclePaused), MockAggregator
script/Deploy.s.sol       DeployLocal (mocks, 31337) · DeployTestnet (mocks, 46630) · DeployMainnet (config/4663.json)
script/RecordClose.s.sol  record the official NVDA close
script/local-demo.sh      one-command local demo (anvil 31337): full flow + summary, then rewinds for the UI
test/unit, test/fork      Foundry tests; fork tests auto-skip unless chainid == 4663
frontend/                 Next.js 14 · wagmi v2 · viem · Tailwind · shadcn-style UI
```

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
cd frontend && npm install && npm run dev     # http://localhost:3000 : the same 12 steps as buttons
```
The home page runs the flow as anvil dev accounts (owner #0, user1 #1, user2 #2), so no wallet is needed.
*Rewind to Friday 16:02* replays it. Rerun the script for a fresh chain. Needs Foundry and jq.

## Hosted demo (Vercel + Render)
The website runs on Vercel, but Vercel can't run a blockchain. The demo chain (anvil 31337, mocks
only, no real funds) runs as a small Docker service on Render, and the site points at it.

1. **Demo chain on Render:** Render dashboard → **New → Blueprint** → pick this repo. It reads
   `render.yaml` and builds `demo-chain/Dockerfile`, which runs `./script/local-demo.sh --serve`:
   deploy, full scripted flow, then rewind to Friday 16:02 New York. Copy the service URL, e.g.
   `https://amen-demo-chain.onrender.com`.
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
