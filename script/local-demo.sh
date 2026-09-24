#!/usr/bin/env bash
# Local Amen demo: anvil pretending to be Robinhood testnet (46630), with the clock set to
# Friday 2026-09-25 15:50 NY (10 min before the cash close). Deploys mocks + core, then moves
# the clock past the bell so the session chip shows VESPERS.
set -euo pipefail
cd "$(dirname "$0")/.."

RPC=${RPC:-http://127.0.0.1:8545}
PK=${PK:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80} # anvil #0 (public test key)
FRI_1550_NY=1790365800   # 2026-09-25 19:50:00 UTC
FRI_1605_NY=1790366700   # 2026-09-25 20:05:00 UTC

if ! cast chain-id --rpc-url "$RPC" >/dev/null 2>&1; then
  echo "starting anvil (chain id 46630)…"
  nohup anvil --chain-id 46630 --timestamp "$FRI_1550_NY" --block-time 2 >"${TMPDIR:-/tmp}/amen-anvil.log" 2>&1 &
  disown || true
  for _ in $(seq 1 30); do cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 1; done
fi

forge script script/Deploy.s.sol:DeployTestnet --rpc-url "$RPC" --private-key "$PK" --broadcast -q

# Move past the Friday close -> Vespers.
cast rpc --rpc-url "$RPC" evm_setNextBlockTimestamp "$FRI_1605_NY" >/dev/null
cast rpc --rpc-url "$RPC" evm_mine >/dev/null

node frontend/scripts/sync-contracts.mjs
echo "deployed: $(cat deployments/46630.json)"
echo "now: cd frontend && npm run dev"
