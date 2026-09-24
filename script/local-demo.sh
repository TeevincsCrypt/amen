#!/usr/bin/env bash
# Amen: one-command local demo on anvil (chain id 31337, mocks only, no real funds).
#
#   ./script/local-demo.sh             full scripted flow + summary, then rewinds the chain to
#                                      Friday 16:01 NY so the same flow can be clicked in the UI
#   ./script/local-demo.sh --no-rewind leave the chain in the final (Monday) state
#   ./script/local-demo.sh --serve     same as the default, then stay in the foreground serving
#                                      the chain (used by demo-chain/Dockerfile for hosting)
#
# Env: ANVIL_HOST (default 127.0.0.1; 0.0.0.0 to expose), ANVIL_PORT (default 8545).
#
# Flow: start anvil → deploy → seed owner/user1/user2 (ETH + USDG) → warp to Fri 16:01 NY (Vespers)
#       → record official close → owner creates NVDA 1% gap market → user1 YES 100, user2 NO 300
#       → owner deposits 100 USDG to Vespers, starts cycle, buys 40 USDG of NVDA inventory
#       → warp to Mon 09:45 NY → YES-winning print $182.00 → resolve → claims
#       → flatten vault → end cycle → summary.
set -euo pipefail
cd "$(dirname "$0")/.."

REWIND=1
SERVE=0
for arg in "$@"; do
  case "$arg" in
    --no-rewind) REWIND=0 ;;
    --serve) SERVE=1 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

ANVIL_HOST=${ANVIL_HOST:-127.0.0.1}
ANVIL_PORT=${ANVIL_PORT:-8545}
RPC=http://127.0.0.1:$ANVIL_PORT
# Well-known anvil dev keys (default mnemonic). Local only, never use anywhere else.
PK_OWNER=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
PK_USER1=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
PK_USER2=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
OWNER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
USER1=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
USER2=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC

T_DEPLOY=1790365800   # Fri 2026-09-25 15:50 NY (19:50 UTC), 10 min before the bell
T_VESPERS=1790366460  # Fri 2026-09-25 16:01 NY (20:01 UTC)
T_MONDAY=1790603100   # Mon 2026-09-28 09:45 NY (13:45 UTC)

LOG_DIR=${TMPDIR:-/tmp}
PIDFILE="$LOG_DIR/amen-anvil.pid"

say()  { printf '\033[2m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*"; }
die()  { echo "error: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "missing '$1' (install Foundry: forge/cast/anvil; and jq)"; }
need anvil; need forge; need cast; need jq

alive() { [[ "$(cast chain-id --rpc-url "$RPC" 2>/dev/null)" =~ ^[0-9]+$ ]]; }

# ── 1. anvil ──────────────────────────────────────────────────────────────
if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  say "stopping previous demo anvil (pid $(cat "$PIDFILE"))"
  kill "$(cat "$PIDFILE")"; sleep 1
fi
if alive; then
  die "something else is already listening on $RPC; stop it first"
fi
say "starting anvil (chain id 31337, clock = Fri 15:50 New York)"
nohup anvil --chain-id 31337 --timestamp "$T_DEPLOY" --host "$ANVIL_HOST" --port "$ANVIL_PORT" \
  >"$LOG_DIR/amen-anvil.log" 2>&1 &
echo $! >"$PIDFILE"
for _ in $(seq 1 30); do alive && break; sleep 1; done
[[ "$(cast chain-id --rpc-url "$RPC")" == "31337" ]] || die "anvil did not start (see $LOG_DIR/amen-anvil.log)"

rpc()  { cast rpc --rpc-url "$RPC" "$@" >/dev/null; }
warp() { rpc evm_setNextBlockTimestamp "$1"; rpc evm_mine; }
send() { local pk=$1; shift; cast send --rpc-url "$RPC" --private-key "$pk" "$@" >/dev/null; }
call() { cast call --rpc-url "$RPC" "$@"; }
jcall() { cast call --rpc-url "$RPC" --json "$@"; }
u6()   { cast format-units "$1" 6; }
u18()  { cast format-units "$1" 18; }
now()  { cast block latest --rpc-url "$RPC" --field timestamp; }
ny()   { TZ=America/New_York date -d "@$1" '+%a %b %d %H:%M:%S %Z'; }

# ── 2. deploy ─────────────────────────────────────────────────────────────
say "deploying mocks + AmenOracle + VespersVault + AmenMarket"
forge script script/Deploy.s.sol:DeployLocal --rpc-url "$RPC" --private-key "$PK_OWNER" --broadcast -q >/dev/null
DEP=deployments/31337.json
USDG=$(jq -r .usdg $DEP); NVDA=$(jq -r .nvda $DEP); FEED=$(jq -r .nvdaFeed $DEP)
ORACLE=$(jq -r .oracle $DEP); VAULT=$(jq -r .vault $DEP); MARKET=$(jq -r .market $DEP); VENUE=$(jq -r .mockVenue $DEP)

# ── 3. seed ───────────────────────────────────────────────────────────────
say "seeding owner, user1, user2 with 100 ETH (deploy already minted 10,000 USDG + 2 NVDA each)"
for a in $OWNER $USER1 $USER2; do rpc anvil_setBalance "$a" 0x56BC75E2D63100000; done
for pk in $PK_OWNER $PK_USER1 $PK_USER2; do
  send "$pk" "$USDG" "approve(address,uint256)" "$MARKET" "$(cast max-uint)"
  send "$pk" "$USDG" "approve(address,uint256)" "$VAULT" "$(cast max-uint)"
done

# ── 4. Vespers ────────────────────────────────────────────────────────────
say "warp → Fri 16:01 New York (cash closed: Vespers)"
warp "$T_VESPERS"
# More tickers: record their Friday closes and open their weekend gap markets, with a few bets,
# so the market board is multi-ticker from the start. NVDA stays the scripted story below.
say "listing the other tickers: closes + gap markets + a few bets (AAPL, SPY, TSLA, MSFT)"
SID=$(call "$ORACLE" "lastCloseAt(uint256)(uint256,uint256)" "$(now)" | head -1 | awk '{print $1}')
OTHER_STOCKS=()
for t in $(call "$ORACLE" "allStocks()(address[])" | tr -d '[],'); do
  [[ "${t,,}" == "${NVDA,,}" ]] && continue
  OTHER_STOCKS+=("$t")
  send $PK_OWNER "$ORACLE" "recordSessionClose(address)" "$t"
  send $PK_OWNER "$MARKET" "createGapMarket(address,uint256,uint256,uint256,uint256)" "$t" "$SID" 100 0 10000000000
  id=$(call "$MARKET" "marketCount()(uint256)" | awk '{print $1}')
  send $PK_USER1 "$MARKET" "buy(uint256,bool,uint256)" "$id" true $(( (40 + id * 15) * 1000000 ))
  send $PK_USER2 "$MARKET" "buy(uint256,bool,uint256)" "$id" false $(( (90 + id * 25) * 1000000 ))
done

SNAP=$(cast rpc --rpc-url "$RPC" evm_snapshot | tr -d '"')
mkdir -p frontend/public
printf '{ "snapshotId": "%s", "runId": "%s" }\n' "$SNAP" "$(date +%s)" >frontend/public/demo-snapshot.json

# ── 5. scripted flow (the UI's buttons do exactly these, in this order) ──
say "1. record official close (permissionless)"
send $PK_OWNER "$ORACLE" "recordSessionClose(address)" "$NVDA"
SESSION=$(call "$ORACLE" "lastRecordedSession(address)(uint256)" "$NVDA" | awk '{print $1}')

say "2. owner creates NVDA gap market, strike 100 bps (1%)"
send $PK_OWNER "$MARKET" "createGapMarket(address,uint256,uint256,uint256,uint256)" "$NVDA" "$SESSION" 100 0 10000000000
MID=$(call "$MARKET" "marketCount()(uint256)" | awk '{print $1}')

say "3. user1 buys 100 USDG YES"
send $PK_USER1 "$MARKET" "buy(uint256,bool,uint256)" "$MID" true 100000000
say "4. user2 buys 300 USDG NO"
send $PK_USER2 "$MARKET" "buy(uint256,bool,uint256)" "$MID" false 300000000

say "5. owner deposits 100 USDG into Vespers"
send $PK_OWNER "$VAULT" "deposit(uint256,address)" 100000000 "$OWNER"
say "6. keeper starts cycle and buys 40 USDG of NVDA inventory at \$180"
send $PK_OWNER "$VAULT" "startCycle()"
send $PK_OWNER "$VAULT" "buyInventory(uint256,uint256)" 40000000 0

say "7. warp → Mon 09:45 New York (cash open)"
warp "$T_MONDAY"
say "8. mock feeds print Monday's open: NVDA \$182.00 (+1.11% vs close → YES), plus the other tickers"
send $PK_OWNER "$FEED" "setAnswer(int256)" 18200000000
send $PK_OWNER "$VENUE" "setPrice(uint256)" 182000000000000000000
# AAPL +1.26%, SPY +0.18%, TSLA −1.80%, MSFT +0.29% (same prints as the UI's step 8)
for t in "${OTHER_STOCKS[@]}"; do
  sym=$(call "$t" "symbol()(string)" | tr -d '"')
  case "$sym" in AAPL) px=23290000000 ;; SPY) px=66120000000 ;; TSLA) px=40262000000 ;; MSFT) px=51150000000 ;; *) continue ;; esac
  send $PK_OWNER "$(call "$ORACLE" "feedOf(address)(address)" "$t")" "setAnswer(int256)" "$px"
done

say "9. resolve (permissionless)"
send $PK_OWNER "$MARKET" "resolve(uint256)" "$MID"

say "10. claims"
U1_BEFORE=$(call "$USDG" "balanceOf(address)(uint256)" $USER1 | awk '{print $1}')
send $PK_USER1 "$MARKET" "claim(uint256)" "$MID"
U1_AFTER=$(call "$USDG" "balanceOf(address)(uint256)" $USER1 | awk '{print $1}')
U2_CLAIMABLE=$(call "$MARKET" "claimable(uint256,address)(uint256)" "$MID" $USER2 | awk '{print $1}')
if [[ "$U2_CLAIMABLE" != "0" ]]; then send $PK_USER2 "$MARKET" "claim(uint256)" "$MID"; fi

say "11. flatten vault and end cycle"
send $PK_OWNER "$VAULT" "flatten(uint256)" 0
send $PK_OWNER "$VAULT" "endCycle()"

# ── 6. summary ────────────────────────────────────────────────────────────
SS=$(jcall "$ORACLE" "sessionState()(bool,bool,bool,uint256,uint256)")
CLOSE=$(jcall "$ORACLE" "officialClose(address,uint256)((uint256,uint256,uint80,bool,bool,bytes32))" "$NVDA" "$SESSION")
MK=$(jcall "$MARKET" "getMarket(uint256)((uint256,uint8,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool,bool,bool,bytes32,uint256,uint256,uint256,uint256,uint256,uint80,uint256))" "$MID")
CY=$(jcall "$VAULT" "cycles(uint256)((uint256,uint256,uint256,uint256,uint256,int256,uint256))" 1)
# Flatten cast's JSON output to one raw token per line (no jq number parsing → no float rounding).
tuple() { echo "$1" | tr -d '[]" \n' | tr ',' '\n'; }
mapfile -t C < <(tuple "$CLOSE"); mapfile -t M < <(tuple "$MK"); mapfile -t Y < <(tuple "$CY"); mapfile -t S < <(tuple "$SS")
NOW=$(now)

cat <<EOF

════════════════════════════ AMEN · LOCAL DEMO SUMMARY ════════════════════════════
 Chain        anvil 31337 (mocks)        chain time $(ny "$NOW")
 Session      cashOpen=${S[0]}  vespers=${S[1]}  frozen=${S[2]}
 Close mark   \$$(u18 "${C[0]}")  (Chainlink round ${C[2]} @ $(ny "${C[1]}"), session $SESSION)
 Market #$MID   NVDA gap ≥ 1.00%  | YES pool $(u6 "${M[9]}")  NO pool $(u6 "${M[10]}") USDG
 Resolve mark \$$(u18 "${M[18]}")  (round ${M[20]} @ $(ny "${M[19]}"))  move ${M[21]} bps → $( [[ "${M[12]}" == "true" ]] && echo YES || echo NO ) wins
 Claims       user1 (YES 100) claimed $(u6 $((U1_AFTER - U1_BEFORE))) USDG · user2 (NO 300) claimable $(u6 "$U2_CLAIMABLE") USDG (lost)
 Taker fee    $(u6 "$(call "$MARKET" "accruedFees()(uint256)" | awk '{print $1}')") USDG accrued to feeRecipient
 Vault cycle  NAV $(u6 "${Y[3]}") → $(u6 "${Y[4]}") USDG · realized PnL $(u6 "${Y[5]}") · perf fee $(u6 "${Y[6]}") USDG
 Inventory    NVDA held $(u18 "$(call "$VAULT" "stockHeld()(uint256)" | awk '{print $1}')") (flat)
 Tickers      $(call "$ORACLE" "stockCount()(uint256)" | awk '{print $1}') listed · $(call "$MARKET" "marketCount()(uint256)" | awk '{print $1}') markets (the non-NVDA ones are left for anyone to resolve in the UI)
════════════════════════════════════════════════════════════════════════════════════
EOF

# ── 7. rewind for the UI ──────────────────────────────────────────────────
if [[ $REWIND == 1 ]]; then
  cast rpc --rpc-url "$RPC" evm_revert "$SNAP" >/dev/null
  warp $((T_VESPERS + 60))
  SNAP=$(cast rpc --rpc-url "$RPC" evm_snapshot | tr -d '"')
  printf '{ "snapshotId": "%s", "runId": "%s" }\n' "$SNAP" "$(date +%s)" >frontend/public/demo-snapshot.json
  say "chain rewound to Fri 16:02 New York (Vespers): replay the same flow in the UI"
fi
[[ -d frontend/node_modules ]] && node frontend/scripts/sync-contracts.mjs >/dev/null || true
echo
echo "UI:  cd frontend && npm install && npm run dev   →  http://localhost:3000"
echo "anvil keeps running (pid $(cat "$PIDFILE")); rerun this script for a fresh chain."

if [[ $SERVE == 1 ]]; then
  echo "serving the demo chain on $ANVIL_HOST:$ANVIL_PORT (Ctrl-C to stop)"
  tail -n +1 -f "$LOG_DIR/amen-anvil.log" &
  while kill -0 "$(cat "$PIDFILE")" 2>/dev/null; do sleep 5; done
  echo "anvil exited" >&2
  exit 1
fi
