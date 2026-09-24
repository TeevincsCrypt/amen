# Verification: Robinhood Chain 4663

The build sandbox cannot reach `rpc.mainnet.chain.robinhood.com`, Alchemy or Blockscout: its egress
proxy returns 403. So the fork suite skips itself there. Run these commands locally.

## 1. Quick RPC reads (curl)
```bash
RH_RPC=https://rpc.mainnet.chain.robinhood.com
call() { curl -s -X POST -H 'content-type: application/json' \
  --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_call\",\"params\":[{\"to\":\"$1\",\"data\":\"$2\"},\"latest\"]}" $RH_RPC; echo; }

curl -s -X POST -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' $RH_RPC; echo   # expect 0x1237
call 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 0x313ce567   # USDG decimals() -> ...06
call 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 0x313ce567   # NVDA decimals() -> ...12 (18)
call 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 0x313ce567   # feed decimals() -> ...08
call 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 0xfeaf968c   # feed latestRoundData()
```

## 2. Same checks with cast
```bash
cast chain-id --rpc-url $RH_RPC                                                              # 4663
cast call 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 "decimals()(uint8)" --rpc-url $RH_RPC   # 6
cast call 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC "symbol()(string)" --rpc-url $RH_RPC
cast call 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC "decimals()(uint8)" --rpc-url $RH_RPC   # 18
cast call 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC "uiMultiplier()(uint256)" --rpc-url $RH_RPC   # ~1000775000000000000
cast call 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC "oraclePaused()(bool)" --rpc-url $RH_RPC      # false
cast call 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 "decimals()(uint8)" --rpc-url $RH_RPC   # 8
cast call 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 \
  "latestRoundData()(uint80,int256,uint256,uint256,uint80)" --rpc-url $RH_RPC
cast call 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA \
  "getPool(address,address,uint24)(address)" \
  0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 500 \
  --rpc-url $RH_RPC                                                                           # 0xd4eb…14a3
cast call 0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3 "fee()(uint24)" --rpc-url $RH_RPC       # 500
```

## 3. Fork test suite
```bash
git submodule update --init --recursive
RH_RPC=https://rpc.mainnet.chain.robinhood.com \
  forge test --match-path 'test/fork/*' --fork-url $RH_RPC -vv
```
Expected: 6 tests pass (none skipped):
- `test_Fork_BytecodePresent`
- `test_Fork_UsdgIs6Decimals`
- `test_Fork_NvdaStockToken` (asserts `oraclePaused()` exists and logs its value and `uiMultiplier`)
- `test_Fork_NvdaFeed` (asserts 8 decimals and that `getRoundData(latest − 1)` works)
- `test_Fork_UniswapPool` (`factory.getPool(USDG, NVDA, 500)` equals the configured pool; checks fee and tokens)
- `test_Fork_DeployAndMark` (deploys Oracle/Vault/Market on the fork, reads a live mark, asserts not paused, `maxDeviationBps == 50`)

If the output shows `[SKIP]`, the fork's chain id isn't 4663. Check the RPC URL.

## 4. Dry-run the mainnet deploy (no broadcast)
```bash
forge script script/Deploy.s.sol:DeployMainnet --fork-url $RH_RPC -vv   # simulation only, no --broadcast
```
This re-checks decimals, bytecode, feed decimals == 8 and the factory → pool mapping, then simulates the
deployment. The simulation still writes `deployments/4663.json` with *simulated* addresses, so delete
it afterwards (`git checkout -- deployments/ || rm deployments/4663.json`). **Do not add `--broadcast`.** Phase 1 is not being deployed as part of this pass.
