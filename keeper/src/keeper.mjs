// Amen Protocol keeper.
//
// Runs the protocol's routine, time-driven jobs so markets don't void for lack of a caller:
//   1. record the official close after the 16:00 New York bell (the last Chainlink round at or
//      before the bell, within 30 min);
//   2. create the NVDA gap market for that close (weekend closes by default);
//   3. resolve each market with the first cash-session round at or after its resolve time,
//      or void it once the 60-minute window has passed (so stakes can be refunded);
//   4. keep Vespers Vault cycle books (start at the close, end at the open when flat).
//
// Safety: every write is simulated first and skipped if it would revert. The keeper wallet
// only needs keeper rights and a little ETH for gas; it can never set prices or move user funds.
// Nothing here is clever: when in doubt it logs and waits, and the contracts' own rules
// (freeze, void, refund) decide.

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, defineChain, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ───────────────────────────── config ─────────────────────────────

const env = (k, d) => (process.env[k] === undefined || process.env[k] === "" ? d : process.env[k]);
const ONCE = process.argv.includes("--once");
const DRY_RUN = env("DRY_RUN", "false") === "true";
const CHAIN_ID = Number(env("CHAIN_ID", "4663"));
const RPC_URL = env("RPC_URL", CHAIN_ID === 4663 ? "https://rpc.mainnet.chain.robinhood.com" : "http://127.0.0.1:8545");
const INTERVAL_SEC = Number(env("INTERVAL_SEC", "30"));
const MARKET_SCHEDULE = env("MARKET_SCHEDULE", "weekend"); // weekend | daily | off
const STRIKE_BPS = BigInt(env("STRIKE_BPS", "100"));
const MARKET_NOTIONAL_USDG = env("MARKET_NOTIONAL_USDG", ""); // default: the contract's maxNotionalLimit
const MIN_TRADING_WINDOW_SEC = Number(env("MIN_TRADING_WINDOW_SEC", "3600"));
const VAULT_CYCLES = env("VAULT_CYCLES", "on") === "on";
const MAX_ROUND_WALK = Number(env("MAX_ROUND_WALK", "600"));
const PORT = env("PORT", "");

const here = dirname(fileURLToPath(import.meta.url));
function loadDeployment() {
  const path = env("DEPLOYMENT_FILE", join(here, "..", "..", "deployments", `${CHAIN_ID}.json`));
  let d = {};
  try {
    d = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // fall back to env-only config
  }
  const pick = (k, e) => env(e, d[k]);
  const out = { oracle: pick("oracle", "ORACLE"), market: pick("market", "MARKET"), vault: pick("vault", "VAULT"), nvda: pick("nvda", "NVDA") };
  for (const [k, v] of Object.entries(out)) if (!v) throw new Error(`missing ${k} address (deployments/${CHAIN_ID}.json or env ${k.toUpperCase()})`);
  return out;
}
const D = loadDeployment();

const chain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 4663 ? "Robinhood Chain" : `chain ${CHAIN_ID}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});
const pub = createPublicClient({ chain, transport: http(RPC_URL, { retryCount: 2 }) });
const pk = env("KEEPER_PRIVATE_KEY", "");
if (!pk && !DRY_RUN) throw new Error("KEEPER_PRIVATE_KEY is required (or set DRY_RUN=true)");
const account = pk ? privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`) : undefined;
const wallet = account ? createWalletClient({ account, chain, transport: http(RPC_URL, { retryCount: 2 }) }) : undefined;

// ───────────────────────────── ABIs (only what the keeper calls) ─────────────────────────────

const oracleAbi = parseAbi([
  "function isCashOpen() view returns (bool)",
  "function isVespers() view returns (bool)",
  "function isCashOpenAt(uint256) view returns (bool)",
  "function lastCloseAt(uint256) view returns (uint256 sessionId, uint256 closeTs)",
  "function nextOpenAfter(uint256) view returns (uint256)",
  "function hasOfficialClose(address,uint256) view returns (bool)",
  "function latestRoundId(address) view returns (uint80)",
  "function getRoundMark(address,uint80) view returns (bool ok, uint256 priceUsd, uint256 updatedAt)",
  "function getMark(address) view returns ((uint256 priceUsd, uint256 updatedAt, uint80 roundId, bool cashOpen, bool frozen, bytes32 freezeReason))",
  "function isKeeper(address) view returns (bool)",
  "function recordSessionClose(address)",
  "function recordSessionCloseAtRound(address,uint80)",
  "error AlreadyRecorded(address stockToken, uint256 sessionId)",
  "error RoundOutsideCloseWindow(uint80 roundId, uint256 updatedAt, uint256 closeTs)",
  "error RoundNotLastBeforeClose(uint80 roundId)",
  "error OracleFrozen(bytes32 reason)",
  "error CashOpen()",
  "error BadRound(uint80 roundId)",
]);
const marketAbi = parseAbi([
  "function marketCount() view returns (uint256)",
  "function maxNotionalLimit() view returns (uint256)",
  "function getMarket(uint256) view returns ((uint256 id, uint8 kind, address stockToken, uint256 strikeBps, uint256 closeMarkPrice, uint256 closeMarkTs, uint256 startTs, uint256 endTs, uint256 resolveEarliestTs, uint256 yesPool, uint256 noPool, bool resolved, bool yesWins, bool voided, bytes32 resolveReason, uint256 sessionId, uint256 maxNotional, uint256 takerFeeBps, uint256 resolvePrice, uint256 resolveMarkTs, uint80 resolveRoundId, uint256 moveBps))",
  "function createGapMarket(address,uint256,uint256,uint256,uint256) returns (uint256)",
  "function resolveWithRound(uint256,uint80)",
  "function voidMarket(uint256)",
  "error OracleFrozen(bytes32 reason)",
  "error CashClosed()",
  "error ResolveRoundInvalid(uint80 roundId)",
  "error ResolveWindowOver(uint256 marketId)",
  "error TooEarly(uint256 nowTs, uint256 earliestTs)",
  "error AlreadySettled(uint256 marketId)",
  "error VoidNotYetAllowed(uint256 marketId)",
  "error InvalidParam()",
  "error NotKeeper(address caller)",
]);
const vaultAbi = parseAbi([
  "function cycleActive() view returns (bool)",
  "function stockHeld() view returns (uint256)",
  "function swapAdapter() view returns (address)",
  "function startCycle()",
  "function endCycle()",
  "function flatten(uint256) returns (uint256)",
  "error NotVespers()",
  "error CycleActive()",
  "error NoActiveCycle()",
  "error NotFlat()",
  "error CashClosed()",
  "error OracleFrozen(bytes32 reason)",
]);

const RESOLVE_WINDOW = 3600n;
const CLOSE_LOOKBACK = 1800n;

// ───────────────────────────── helpers ─────────────────────────────

const state = { startedAt: new Date().toISOString(), lastTick: null, lastError: null, ticks: 0, sent: [] };

function log(level, msg, extra) {
  const line = `${new Date().toISOString()} ${level.padEnd(5)} ${msg}${extra ? " " + JSON.stringify(extra, (_, v) => (typeof v === "bigint" ? v.toString() : v)) : ""}`;
  (level === "ERROR" ? console.error : console.log)(line);
}

function reason(e) {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ?? r.reason ?? r.shortMessage;
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}

const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });

/** Simulate, then send and wait. Returns true on success; logs and returns false if it would revert. */
async function write(label, address, abi, functionName, args = []) {
  try {
    await pub.simulateContract({ address, abi, functionName, args, account: account?.address ?? env("KEEPER_ADDRESS", undefined) });
  } catch (e) {
    log("SKIP", `${label}: would revert (${reason(e)})`);
    return false;
  }
  if (DRY_RUN) {
    log("DRY", `${label}: simulation ok, not sent (DRY_RUN)`);
    return true;
  }
  const hash = await wallet.writeContract({ address, abi, functionName, args });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`${label}: reverted on-chain (${hash})`);
  log("TX", `${label}`, { hash, block: rc.blockNumber });
  state.sent.unshift({ label, hash, at: new Date().toISOString() });
  state.sent = state.sent.slice(0, 20);
  return true;
}

/** Round data via the oracle (price normalized to 18 dec); null if the round is missing or invalid. */
async function round(rid) {
  if (rid <= 0n) return null;
  const [ok, price, upd] = await read(D.oracle, oracleAbi, "getRoundMark", [D.nvda, rid]);
  return ok ? { rid, price, upd } : null;
}

// ───────────────────────────── jobs ─────────────────────────────

/** 1. Record the official close: the last round at or before the bell, within 30 minutes. */
async function jobRecordClose(now) {
  if (await read(D.oracle, oracleAbi, "isCashOpen")) return;
  const [sid, closeTs] = await read(D.oracle, oracleAbi, "lastCloseAt", [now]);
  if (await read(D.oracle, oracleAbi, "hasOfficialClose", [D.nvda, sid])) return;

  const latest = await read(D.oracle, oracleAbi, "latestRoundId", [D.nvda]);
  let rid = latest;
  let r = await round(rid);
  for (let i = 0; r && r.upd > closeTs && i < MAX_ROUND_WALK; i++) {
    rid -= 1n;
    r = await round(rid);
  }
  if (!r || r.upd > closeTs) {
    log("WARN", "record close: could not find a round at or before the bell", { sessionId: sid, closeTs });
    return;
  }
  if (r.upd + CLOSE_LOOKBACK < closeTs) {
    log("WARN", "record close: last round before the bell is older than 30 min; not recording automatically. The owner (Safe) or keeper may forceRecordSessionClose if appropriate.", {
      sessionId: sid,
      roundId: r.rid,
      updatedAt: r.upd,
      closeTs,
    });
    return;
  }
  if (r.rid === latest) await write(`record close (session ${sid}, latest round ${r.rid})`, D.oracle, oracleAbi, "recordSessionClose", [D.nvda]);
  else await write(`record close (session ${sid}, round ${r.rid})`, D.oracle, oracleAbi, "recordSessionCloseAtRound", [D.nvda, r.rid]);
}

/** Markets whose resolve window could still matter (newest first). */
async function recentMarkets(limit = 25) {
  const count = await read(D.market, marketAbi, "marketCount");
  const out = [];
  for (let id = count; id >= 1n && out.length < limit; id--) out.push(await read(D.market, marketAbi, "getMarket", [id]));
  return out;
}

/** 2. Create the gap market for the latest recorded close (weekend closes by default). */
async function jobCreateMarket(now, markets) {
  if (MARKET_SCHEDULE === "off") return;
  if (await read(D.oracle, oracleAbi, "isCashOpen")) return;
  const [sid, closeTs] = await read(D.oracle, oracleAbi, "lastCloseAt", [now]);
  if (!(await read(D.oracle, oracleAbi, "hasOfficialClose", [D.nvda, sid]))) return;
  if (markets.some((m) => m.sessionId === sid && m.kind === 0)) return;
  const nextOpen = await read(D.oracle, oracleAbi, "nextOpenAfter", [closeTs]);
  if (MARKET_SCHEDULE === "weekend" && nextOpen - closeTs < 86_400n) return; // overnight only: not a weekend/holiday gap
  if (nextOpen - now < BigInt(MIN_TRADING_WINDOW_SEC)) {
    log("INFO", "create market: too close to the open to be worth trading; skipping", { sessionId: sid, nextOpen });
    return;
  }
  const limit = await read(D.market, marketAbi, "maxNotionalLimit");
  const wanted = MARKET_NOTIONAL_USDG ? BigInt(Math.round(Number(MARKET_NOTIONAL_USDG) * 1e6)) : limit;
  const notional = wanted < limit ? wanted : limit;
  await write(`create gap market (session ${sid}, ${Number(STRIKE_BPS) / 100}%, cap ${Number(notional) / 1e6} USDG)`, D.market, marketAbi, "createGapMarket", [
    D.nvda,
    sid,
    STRIKE_BPS,
    0n,
    notional,
  ]);
}

/** First round with updatedAt >= earliest whose predecessor is < earliest (what the contract requires). */
async function firstRoundAtOrAfter(earliest) {
  let rid = await read(D.oracle, oracleAbi, "latestRoundId", [D.nvda]);
  let r = await round(rid);
  if (!r || r.upd < earliest) return null; // nothing published since the resolve time yet
  for (let i = 0; i < MAX_ROUND_WALK; i++) {
    const prev = await round(rid - 1n);
    if (!prev) return null; // phase boundary or bad data: can't prove it; the market will void
    if (prev.upd < earliest) return r;
    rid -= 1n;
    r = prev;
  }
  return null;
}

/** 3. Resolve markets in their window; void the ones whose window has passed. */
async function jobSettle(now, markets) {
  for (const m of markets) {
    if (m.resolved || m.voided) continue;
    const earliest = m.resolveEarliestTs;
    if (now < earliest) continue;
    if (now > earliest + RESOLVE_WINDOW) {
      await write(`void market #${m.id} (no resolve within 60 min)`, D.market, marketAbi, "voidMarket", [m.id]);
      continue;
    }
    const mark = await read(D.oracle, oracleAbi, "getMark", [D.nvda]);
    if (mark.frozen) {
      log("WAIT", `market #${m.id}: oracle frozen (${Buffer.from(mark.freezeReason.slice(2), "hex").toString().replace(/\0/g, "")}); retrying`);
      continue;
    }
    const r = await firstRoundAtOrAfter(earliest);
    if (!r) {
      log("WAIT", `market #${m.id}: no cash-session print at or after the resolve time yet`);
      continue;
    }
    if (r.upd > earliest + RESOLVE_WINDOW || !(await read(D.oracle, oracleAbi, "isCashOpenAt", [r.upd]))) {
      log("WARN", `market #${m.id}: first print after the resolve time is not a valid cash-session print; it will void`, { roundId: r.rid, updatedAt: r.upd });
      continue;
    }
    await write(`resolve market #${m.id} with round ${r.rid}`, D.market, marketAbi, "resolveWithRound", [m.id, r.rid]);
  }
}

/** 4. Vault cycle books: start at the close when flat, flatten and end at the open. */
async function jobVault() {
  if (!VAULT_CYCLES) return;
  const [active, held, cashOpen, vespers] = await Promise.all([
    read(D.vault, vaultAbi, "cycleActive"),
    read(D.vault, vaultAbi, "stockHeld"),
    read(D.oracle, oracleAbi, "isCashOpen"),
    read(D.oracle, oracleAbi, "isVespers"),
  ]);
  if (!active && vespers && held === 0n) await write("vault: start cycle", D.vault, vaultAbi, "startCycle");
  if (active && cashOpen) {
    if (held > 0n) {
      const adapter = await read(D.vault, vaultAbi, "swapAdapter");
      if (adapter === "0x0000000000000000000000000000000000000000") log("WARN", "vault holds NVDA but no swap adapter is set; cannot flatten");
      else await write("vault: flatten", D.vault, vaultAbi, "flatten", [0n]);
    } else {
      await write("vault: end cycle", D.vault, vaultAbi, "endCycle");
    }
  }
}

// ───────────────────────────── loop ─────────────────────────────

async function tick() {
  const block = await pub.getBlock();
  const now = block.timestamp;
  state.ticks++;
  for (const [name, fn] of [
    ["record close", () => jobRecordClose(now)],
    ["markets", async () => {
      const markets = await recentMarkets();
      await jobCreateMarket(now, markets);
      await jobSettle(now, await recentMarkets());
    }],
    ["vault", () => jobVault()],
  ]) {
    try {
      await fn();
    } catch (e) {
      state.lastError = `${name}: ${reason(e)}`;
      log("ERROR", `${name}: ${reason(e)}`);
    }
  }
  state.lastTick = { at: new Date().toISOString(), chainTime: Number(now), block: Number(block.number) };
}

async function main() {
  const chainId = await pub.getChainId();
  if (chainId !== CHAIN_ID) throw new Error(`RPC chain id ${chainId} != CHAIN_ID ${CHAIN_ID}`);
  if (account) {
    const [isKeeperOracle, isKeeperMarket] = await Promise.all([
      read(D.oracle, oracleAbi, "isKeeper", [account.address]),
      read(D.market, parseAbi(["function isKeeper(address) view returns (bool)"]), "isKeeper", [account.address]),
    ]);
    const bal = await pub.getBalance({ address: account.address });
    log("INFO", "keeper starting", { chainId, keeper: account.address, isKeeperOracle, isKeeperMarket, ethBalanceWei: bal, dryRun: DRY_RUN, schedule: MARKET_SCHEDULE });
    if (!isKeeperMarket) log("WARN", "this wallet is not a keeper on AmenMarket: market creation will be skipped (closes, resolves and voids are permissionless)");
  } else {
    log("INFO", "keeper starting in DRY_RUN without a key (read + simulate only)", { chainId });
  }

  if (PORT) {
    createServer((_, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: !!state.lastTick, ...state }));
    }).listen(Number(PORT), () => log("INFO", `health endpoint on :${PORT}`));
  }

  if (ONCE) {
    await tick();
    return;
  }
  for (;;) {
    await tick().catch((e) => log("ERROR", `tick: ${reason(e)}`));
    await new Promise((r) => setTimeout(r, INTERVAL_SEC * 1000));
  }
}

main().catch((e) => {
  log("ERROR", reason(e));
  process.exit(1);
});
