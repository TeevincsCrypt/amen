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
script/Deploy.s.sol       DeployTestnet (mocks, 46630) · DeployMainnet (config/4663.json, refuses other chains)
script/RecordClose.s.sol  record the official NVDA close
script/local-demo.sh      one-shot local demo (anvil 46630 at Fri 15:50 NY)
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
./script/local-demo.sh            # starts anvil --chain-id 46630, deploys mocks + core, syncs ABIs
cd frontend && npm install && npm run dev   # http://localhost:3000
```
Import anvil accounts #0 (owner/keeper) and #1 into your wallet. The markets and vault pages have
local-only *demo controls* for warping time and pushing mock Chainlink prints. See the demo script in
[BUILDATHON.md](docs/BUILDATHON.md).

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

`deployments/46630.json` in this repo contains the **deterministic local anvil** addresses (default
mnemonic). A real testnet deploy overwrites it.
