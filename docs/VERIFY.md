# Verification: Robinhood Chain 4663

**Status:** not run from the build sandbox. Its egress proxy blocks `rpc.mainnet.chain.robinhood.com`,
Alchemy and Blockscout (HTTP 403). No results are recorded here. Run the commands below on a machine
that can reach the RPC. Nothing here deploys or sends a transaction.

## 1. Fork test suite
```bash
git submodule update --init --recursive
forge test --match-path 'test/fork/*' --fork-url https://rpc.mainnet.chain.robinhood.com -vv
```
Expected: **6 passed, 0 skipped**.
- `test_Fork_BytecodePresent`
- `test_Fork_UsdgIs6Decimals`
- `test_Fork_NvdaStockToken` (`oraclePaused()` exists, and logs `uiMultiplier`)
- `test_Fork_NvdaFeed` (8 decimals, and `getRoundData(latest − 1)` works)
- `test_Fork_UniswapPool` (`getPool(USDG, NVDA, 500)` equals `0xd4eb…14a3`)
- `test_Fork_DeployAndMark` (live mark, not paused, `maxDeviationBps == 50`)

`[SKIP]` means the fork's chain id wasn't 4663.

## 2. curl snippet (needs only curl and python3)
Prints NVDA symbol, decimals, uiMultiplier and oraclePaused, plus USDG decimals and the feed's latestRoundData.
The decoding was checked against the local anvil mocks, which expose the same selectors.
```bash
RH_RPC=${RH_RPC:-https://rpc.mainnet.chain.robinhood.com}
NVDA=${NVDA:-0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC}
USDG=${USDG:-0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168}
FEED=${FEED:-0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15}
ethcall() {  # $1=to $2=4-byte selector -> raw hex result
  curl -s -X POST -H 'content-type: application/json' $RH_RPC \
    --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_call\",\"params\":[{\"to\":\"$1\",\"data\":\"$2\"},\"latest\"]}" \
  | python3 -c 'import sys,json; r=json.load(sys.stdin); print(r.get("result") or "ERROR "+json.dumps(r.get("error")))'
}
dec() { python3 -c '
import sys; kind, h = sys.argv[1], sys.argv[2]
if h.startswith("ERROR"): print(h); sys.exit()
b = bytes.fromhex(h[2:]); w = [int.from_bytes(b[i:i+32], "big") for i in range(0, len(b), 32)]
s = lambda x: x - (1 << 256) if x >> 255 else x
if kind == "uint":   print(w[0])
elif kind == "bool": print(bool(w[0]))
elif kind == "str":  o, n = w[0], w[w[0]//32]; print(b[o+32:o+32+n].decode())
elif kind == "round": print(f"roundId={w[0]} answer={s(w[1])} startedAt={w[2]} updatedAt={w[3]} answeredInRound={w[4]}")
' "$1" "$2"; }
echo "chainId          $(curl -s -X POST -H 'content-type: application/json' $RH_RPC --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | python3 -c 'import sys,json;print(int(json.load(sys.stdin)["result"],16))')   (expect 4663)"
echo "NVDA symbol      $(dec str   $(ethcall $NVDA 0x95d89b41))"
echo "NVDA decimals    $(dec uint  $(ethcall $NVDA 0x313ce567))   (expect 18)"
echo "NVDA uiMultiplier $(dec uint $(ethcall $NVDA 0xa60bf13d))   (expect ~1000775000000000000)"
echo "NVDA oraclePaused $(dec bool $(ethcall $NVDA 0x7706ba52))   (expect False)"
echo "USDG decimals    $(dec uint  $(ethcall $USDG 0x313ce567))   (expect 6)"
echo "Feed decimals    $(dec uint  $(ethcall $FEED 0x313ce567))   (expect 8)"
echo "Feed latestRoundData  $(dec round $(ethcall $FEED 0xfeaf968c))"
```
Selectors used: `symbol()` 0x95d89b41 · `decimals()` 0x313ce567 · `uiMultiplier()` 0xa60bf13d ·
`oraclePaused()` 0x7706ba52 · `latestRoundData()` 0xfeaf968c.

## 3. Deploy dry run (simulation only, never add `--broadcast`)
```bash
forge script script/Deploy.s.sol:DeployMainnet --fork-url https://rpc.mainnet.chain.robinhood.com -vv
```
This re-checks decimals, bytecode, feed decimals == 8 and factory → pool. The swap adapter stays unset
unless `ADAPTER_ENABLED=true`. The simulation still writes `deployments/4663.json` with *simulated*
addresses, so delete it afterwards.
