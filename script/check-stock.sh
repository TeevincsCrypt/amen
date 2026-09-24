#!/usr/bin/env bash
# Check a candidate Stock Token listing on Robinhood Chain before adding it to
# config/stocks-4663.json (or listing it from the Safe after launch).
#   ./script/check-stock.sh <SYMBOL> <TOKEN_ADDRESS> <FEED_ADDRESS> [RPC_URL]
set -euo pipefail
SYM=${1:?symbol}; TOKEN=${2:?token address}; FEED=${3:?feed address}
RPC=${4:-https://rpc.mainnet.chain.robinhood.com}
ok=1
say() { printf '%-26s %s\n' "$1" "$2"; }
fail() { say "$1" "FAIL: $2"; ok=0; }

[[ "$(cast code "$TOKEN" --rpc-url "$RPC")" != "0x" ]] || fail "token bytecode" "no contract at $TOKEN"
[[ "$(cast code "$FEED" --rpc-url "$RPC")" != "0x" ]] || fail "feed bytecode" "no contract at $FEED"
say "token symbol()" "$(cast call "$TOKEN" 'symbol()(string)' --rpc-url "$RPC" 2>/dev/null || echo '?')  (expected ~$SYM)"
dec=$(cast call "$TOKEN" 'decimals()(uint8)' --rpc-url "$RPC" 2>/dev/null || echo '?')
[[ "$dec" == "18" ]] && say "token decimals()" "18" || fail "token decimals()" "$dec (Stock Tokens are 18)"
um=$(cast call "$TOKEN" 'uiMultiplier()(uint256)' --rpc-url "$RPC" 2>/dev/null | awk '{print $1}' || echo 0)
[[ -n "$um" && "$um" != "0" ]] && say "token uiMultiplier()" "$um" || fail "token uiMultiplier()" "missing or zero (not an ERC-8056 Stock Token?)"
say "token oraclePaused()" "$(cast call "$TOKEN" 'oraclePaused()(bool)' --rpc-url "$RPC" 2>/dev/null || echo 'not implemented (treated as not paused)')"
fdec=$(cast call "$FEED" 'decimals()(uint8)' --rpc-url "$RPC" 2>/dev/null || echo '?')
[[ "$fdec" =~ ^[0-9]+$ && "$fdec" -ge 1 && "$fdec" -le 18 ]] && say "feed decimals()" "$fdec" || fail "feed decimals()" "$fdec"
say "feed description()" "$(cast call "$FEED" 'description()(string)' --rpc-url "$RPC" 2>/dev/null || echo '?')  (expected ~$SYM / USD)"
rd=$(cast call "$FEED" 'latestRoundData()(uint80,int256,uint256,uint256,uint80)' --rpc-url "$RPC" 2>/dev/null || true)
if [[ -n "$rd" ]]; then
  ans=$(echo "$rd" | sed -n 2p | awk '{print $1}'); upd=$(echo "$rd" | sed -n 4p | awk '{print $1}')
  [[ "$ans" =~ ^[0-9]+$ && "$ans" != "0" ]] && say "feed latest answer" "$ans (updated $(( $(date +%s) - upd ))s ago)" || fail "feed latest answer" "$ans"
else
  fail "feed latestRoundData()" "call failed"
fi
echo
[[ $ok == 1 ]] && echo "OK: add to config/stocks-4663.json: { \"symbol\": \"$SYM\", \"token\": \"$TOKEN\", \"feed\": \"$FEED\" }" || { echo "Do NOT list $SYM until the failures above are resolved."; exit 1; }
