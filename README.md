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
