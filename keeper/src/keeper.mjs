// Amen Protocol keeper.
//
// Runs the protocol's routine, time-driven jobs so markets don't void for lack of a caller:
// for every Stock Token listed on the oracle (discovered on-chain, so new tickers are picked up
// automatically) and allowed on the market:
//   1. record the official close after the 16:00 New York bell (the last Chainlink round at or
//      before the bell, within 30 min);
//   2. create the gap market for that close (weekend closes by default);
//   3. resolve each market with the first cash-session round at or after its resolve time,
//      or void it once the 60-minute window has passed (so stakes can be refunded);
//   4. keep Vespers Vault cycle books (start at the close, end at the open when flat), and, only
//      if VAULT_TRADING=on and the owner has set a swap adapter, buy the vault's stock during
//      Vespers when the pool sells it at a discount to the mark, then flatten at the open.
//
// Safety: every write is simulated first and skipped if it would revert. The keeper wallet
// only needs keeper rights and a little ETH for gas; it can never set prices or move user funds.
// Nothing here is clever: when in doubt it logs and waits, and the contracts' own rules
// (freeze, void, refund) decide.

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, defineChain, formatEther, http, parseAbi, parseEther } from "viem";
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
// Vault trading (off unless VAULT_TRADING=on; the owner must also have set a swap adapter).
const VAULT_TRADING = env("VAULT_TRADING", "off") === "on";
const VAULT_TARGET_BPS = BigInt(env("VAULT_TARGET_BPS", "2000")); // target inventory, % of NAV (contract caps it too)
const VAULT_MAX_USDG = env("VAULT_MAX_USDG", ""); // optional absolute cap on inventory value, USDG
const VAULT_CHUNK_USDG = BigInt(Math.round(Number(env("VAULT_CHUNK_USDG", "100")) * 1e6)); // max USDG per buy
const VAULT_MIN_EDGE_BPS = BigInt(env("VAULT_MIN_EDGE_BPS", "10")); // buy only this far below the mark
const VAULT_BUY_CUTOFF_MIN = Number(env("VAULT_BUY_CUTOFF_MIN", "60")); // no buys this close to the open
const SLIPPAGE_BPS = 10n; // minOut tolerance between simulation and inclusion
const MAX_ROUND_WALK = Number(env("MAX_ROUND_WALK", "600"));
// Optional comma-separated symbols to auto-create markets for (default: every allowed ticker).
const MARKET_TICKERS = env("MARKET_TICKERS", "").toUpperCase().split(",").map((x) => x.trim()).filter(Boolean);
const PORT = env("PORT", "");
// Alerts: Discord webhook and/or Telegram bot. ALERT_LEVEL=info also reports every transaction.
const ALERT_DISCORD_WEBHOOK = env("ALERT_DISCORD_WEBHOOK", "");
const ALERT_TELEGRAM_BOT_TOKEN = env("ALERT_TELEGRAM_BOT_TOKEN", "");
const ALERT_TELEGRAM_CHAT_ID = env("ALERT_TELEGRAM_CHAT_ID", "");
const ALERT_LEVEL = env("ALERT_LEVEL", "info"); // info | warn
const ALERT_REPEAT_MIN = Number(env("ALERT_REPEAT_MIN", "360")); // same alert at most every 6 h
const LOW_ETH_ALERT = parseEther(env("LOW_ETH_ALERT", "0.002"));

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
  const out = { oracle: pick("oracle", "ORACLE"), market: pick("market", "MARKET"), vault: pick("vault", "VAULT") };
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
  "function allStocks() view returns (address[])",
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
  "function stockAllowed(address) view returns (bool)",
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
  "function stock() view returns (address)",
  "function swapAdapter() view returns (address)",
  "function maxInventoryBps() view returns (uint256)",
  "function maxDeviationBps() view returns (uint256)",
  "function inventory() view returns (uint256 usdgFree, uint256 stockRaw, uint256 stockValueUsdg, uint256 nav, uint256 markPrice, bool frozen, bytes32 freezeReason)",
  "function startCycle()",
  "function endCycle()",
  "function flatten(uint256) returns (uint256)",
  "function buyInventory(uint256,uint256) returns (uint256)",
  "function sellInventory(uint256,uint256) returns (uint256)",
  "error NotVespers()",
  "error InvalidParam()",
  "error ZeroAmount()",
  "error NoSwapAdapter()",
  "error PriceDeviation(uint256 execPrice, uint256 markPrice)",
  "error Slippage(uint256 out, uint256 minOut)",
  "error InventoryCapExceeded(uint256 stockValueUsdg, uint256 capUsdg)",
  "error NotKeeper(address caller)",
  "error CycleActive()",
  "error NoActiveCycle()",
  "error NotFlat()",
  "error CashClosed()",
  "error OracleFrozen(bytes32 reason)",
]);

const erc20Abi = parseAbi(["function symbol() view returns (string)"]);

const RESOLVE_WINDOW = 3600n;
const CLOSE_LOOKBACK = 1800n;

// ───────────────────────────── helpers ─────────────────────────────

const state = { startedAt: new Date().toISOString(), lastTick: null, lastError: null, ticks: 0, sent: [] };

function log(level, msg, extra, alertKey) {
  const line = `${new Date().toISOString()} ${level.padEnd(5)} ${msg}${extra ? " " + JSON.stringify(extra, (_, v) => (typeof v === "bigint" ? v.toString() : v)) : ""}`;
  (level === "ERROR" ? console.error : console.log)(line);
  if (level === "WARN" || level === "ERROR") alert(level, msg, alertKey);
}

/** Log a status line only when it changes, so a 30-second loop doesn't repeat itself. */
const notes = new Map();
function note(key, level, msg) {
  if (notes.get(key) === msg) return;
  notes.set(key, msg);
  log(level, msg);
}

// ───────────────────────────── alerts ─────────────────────────────

const alertSent = new Map();
const EXPLORER = CHAIN_ID === 4663 ? "https://robinhoodchain.blockscout.com" : CHAIN_ID === 46630 ? "https://explorer.testnet.chain.robinhood.com" : "";
const alertsOn = () => !!ALERT_DISCORD_WEBHOOK || (!!ALERT_TELEGRAM_BOT_TOKEN && !!ALERT_TELEGRAM_CHAT_ID);

/**
 * Send one line to Discord and/or Telegram. Never throws and never blocks the keeper: a failed
 * alert is only logged. The same text is sent at most once per ALERT_REPEAT_MIN.
 */
function alert(level, text, key = text) {
  if (!alertsOn()) return;
  if (level === "INFO" && ALERT_LEVEL !== "info") return;
  const last = alertSent.get(key);
  if (last && Date.now() - last < ALERT_REPEAT_MIN * 60_000) return;
  alertSent.set(key, Date.now());
  const icon = level === "ERROR" ? "🔴" : level === "WARN" ? "🟠" : "🟢";
  const msg = `${icon} Amen keeper · chain ${CHAIN_ID}${DRY_RUN ? " · dry run" : ""}\n${text}`;
  const post = (url, body) =>
    fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) })
      .then((r) => (r.ok ? undefined : console.error(`alert failed: ${url.split("/")[2]} HTTP ${r.status}`)))
      .catch((e) => console.error(`alert failed: ${e.message}`));
  if (ALERT_DISCORD_WEBHOOK) post(ALERT_DISCORD_WEBHOOK, { content: msg.slice(0, 1900) });
  if (ALERT_TELEGRAM_BOT_TOKEN && ALERT_TELEGRAM_CHAT_ID) {
    post(`https://api.telegram.org/bot${ALERT_TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: ALERT_TELEGRAM_CHAT_ID, text: msg.slice(0, 3900), disable_web_page_preview: true });
  }
}

/** Warn when the keeper wallet's gas money runs low. Checked every 20 ticks (~10 min). */
async function checkGas() {
  if (!account || state.ticks % 20 !== 1) return;
  const bal = await pub.getBalance({ address: account.address });
  state.ethBalance = formatEther(bal);
  if (bal < LOW_ETH_ALERT) log("WARN", `keeper wallet is low on ETH: ${Number(formatEther(bal)).toFixed(5)} ETH left. Top up ${account.address} on chain ${CHAIN_ID}.`, undefined, "low-eth");
}

const fmtUsdg = (v) => (Number(v) / 1e6).toFixed(2);

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
  alert("INFO", `${label}${EXPLORER ? `\n${EXPLORER}/tx/${hash}` : ""}`);
  state.sent.unshift({ label, hash, at: new Date().toISOString() });
  state.sent = state.sent.slice(0, 20);
  return true;
}

/** Round data via the oracle (price normalized to 18 dec); null if the round is missing or invalid. */
async function round(stock, rid) {
  if (rid <= 0n) return null;
  const [ok, price, upd] = await read(D.oracle, oracleAbi, "getRoundMark", [stock, rid]);
  return ok ? { rid, price, upd } : null;
}

// ───────────────────────────── jobs ─────────────────────────────

const symbols = new Map();
/** Listed and market-allowed Stock Tokens, with their symbols (cached). */
async function listedStocks() {
  const all = await read(D.oracle, oracleAbi, "allStocks");
  const out = [];
  for (const token of all) {
    if (!(await read(D.market, marketAbi, "stockAllowed", [token]))) continue;
    if (!symbols.has(token)) symbols.set(token, await read(token, erc20Abi, "symbol").catch(() => token.slice(0, 8)));
    out.push({ token, symbol: symbols.get(token) });
  }
  return out;
}

/** 1. Record the official close: the last round at or before the bell, within 30 minutes. */
async function jobRecordClose(now, stocks) {
  if (await read(D.oracle, oracleAbi, "isCashOpen")) return;
  const [sid, closeTs] = await read(D.oracle, oracleAbi, "lastCloseAt", [now]);
  for (const { token, symbol } of stocks) {
    try {
      await recordCloseFor(token, symbol, sid, closeTs);
    } catch (e) {
      log("ERROR", `${symbol}: record close: ${reason(e)}`);
    }
  }
}

async function recordCloseFor(stock, symbol, sid, closeTs) {
  if (await read(D.oracle, oracleAbi, "hasOfficialClose", [stock, sid])) return;
  const latest = await read(D.oracle, oracleAbi, "latestRoundId", [stock]);
  let rid = latest;
  let r = await round(stock, rid);
  for (let i = 0; r && r.upd > closeTs && i < MAX_ROUND_WALK; i++) {
    rid -= 1n;
    r = await round(stock, rid);
  }
  if (!r || r.upd > closeTs) {
    log("WARN", `${symbol}: record close: could not find a round at or before the bell`, { sessionId: sid, closeTs });
    return;
  }
  if (r.upd + CLOSE_LOOKBACK < closeTs) {
    log("WARN", `${symbol}: record close: last round before the bell is older than 30 min; not recording automatically. The owner (Safe) or keeper may forceRecordSessionClose if appropriate.`, {
      sessionId: sid,
      roundId: r.rid,
      updatedAt: r.upd,
      closeTs,
    });
    return;
  }
  if (r.rid === latest) await write(`${symbol}: record close (session ${sid}, latest round ${r.rid})`, D.oracle, oracleAbi, "recordSessionClose", [stock]);
  else await write(`${symbol}: record close (session ${sid}, round ${r.rid})`, D.oracle, oracleAbi, "recordSessionCloseAtRound", [stock, r.rid]);
}

/** Markets whose resolve window could still matter (newest first). */
async function recentMarkets(limit = 50) {
  const count = await read(D.market, marketAbi, "marketCount");
  const out = [];
  for (let id = count; id >= 1n && out.length < limit; id--) out.push(await read(D.market, marketAbi, "getMarket", [id]));
  return out;
}

/** 2. Create the gap market for the latest recorded close (weekend closes by default). */
async function jobCreateMarket(now, markets, stocks) {
  if (MARKET_SCHEDULE === "off") return;
  if (await read(D.oracle, oracleAbi, "isCashOpen")) return;
  const [sid, closeTs] = await read(D.oracle, oracleAbi, "lastCloseAt", [now]);
  const nextOpen = await read(D.oracle, oracleAbi, "nextOpenAfter", [closeTs]);
  if (MARKET_SCHEDULE === "weekend" && nextOpen - closeTs < 86_400n) return; // overnight only: not a weekend/holiday gap
  if (nextOpen - now < BigInt(MIN_TRADING_WINDOW_SEC)) return; // too close to the open to be worth trading
  const limit = await read(D.market, marketAbi, "maxNotionalLimit");
  const wanted = MARKET_NOTIONAL_USDG ? BigInt(Math.round(Number(MARKET_NOTIONAL_USDG) * 1e6)) : limit;
  const notional = wanted < limit ? wanted : limit;
  for (const { token, symbol } of stocks) {
    if (MARKET_TICKERS.length && !MARKET_TICKERS.includes(String(symbol).toUpperCase())) continue;
    if (markets.some((m) => m.sessionId === sid && m.kind === 0 && m.stockToken.toLowerCase() === token.toLowerCase())) continue;
    if (!(await read(D.oracle, oracleAbi, "hasOfficialClose", [token, sid]))) continue;
    await write(`${symbol}: create gap market (session ${sid}, ${Number(STRIKE_BPS) / 100}%, cap ${Number(notional) / 1e6} USDG)`, D.market, marketAbi, "createGapMarket", [
      token,
      sid,
      STRIKE_BPS,
      0n,
      notional,
    ]);
  }
}

/** First round with updatedAt >= earliest whose predecessor is < earliest (what the contract requires). */
async function firstRoundAtOrAfter(stock, earliest) {
  let rid = await read(D.oracle, oracleAbi, "latestRoundId", [stock]);
  let r = await round(stock, rid);
  if (!r || r.upd < earliest) return null; // nothing published since the resolve time yet
  for (let i = 0; i < MAX_ROUND_WALK; i++) {
    const prev = await round(stock, rid - 1n);
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
    const stock = m.stockToken;
    const sym = symbols.get(stock) ?? stock.slice(0, 8);
    const earliest = m.resolveEarliestTs;
    if (now < earliest) continue;
    if (now > earliest + RESOLVE_WINDOW) {
      await write(`${sym}: void market #${m.id} (no resolve within 60 min)`, D.market, marketAbi, "voidMarket", [m.id]);
      continue;
    }
    const mark = await read(D.oracle, oracleAbi, "getMark", [stock]);
    if (mark.frozen) {
      log("WAIT", `${sym}: market #${m.id}: oracle frozen (${Buffer.from(mark.freezeReason.slice(2), "hex").toString().replace(/\0/g, "")}); retrying`);
      continue;
    }
    const r = await firstRoundAtOrAfter(stock, earliest);
    if (!r) {
      log("WAIT", `${sym}: market #${m.id}: no cash-session print at or after the resolve time yet`);
      continue;
    }
    if (r.upd > earliest + RESOLVE_WINDOW || !(await read(D.oracle, oracleAbi, "isCashOpenAt", [r.upd]))) {
      log("WARN", `${sym}: market #${m.id}: first print after the resolve time is not a valid cash-session print; it will void`, { roundId: r.rid, updatedAt: r.upd });
      continue;
    }
    await write(`${sym}: resolve market #${m.id} with round ${r.rid}`, D.market, marketAbi, "resolveWithRound", [m.id, r.rid]);
  }
}

/** 4. Vault cycle books: start at the close when flat; trade in Vespers if enabled; flatten and end at the open. */
async function jobVault(now) {
  if (!VAULT_CYCLES) return;
  const [active, held, cashOpen, vespers, adapter] = await Promise.all([
    read(D.vault, vaultAbi, "cycleActive"),
    read(D.vault, vaultAbi, "stockHeld"),
    read(D.oracle, oracleAbi, "isCashOpen"),
    read(D.oracle, oracleAbi, "isVespers"),
    read(D.vault, vaultAbi, "swapAdapter"),
  ]);
  const trading = adapter !== ZERO;
  if (!active && vespers && held === 0n) {
    await write("vault: start cycle", D.vault, vaultAbi, "startCycle");
    return;
  }
  if (active && vespers && VAULT_TRADING) {
    if (!trading) note("vault-no-adapter", "INFO", "VAULT_TRADING=on but the owner hasn't set a swap adapter; not trading");
    else await vaultBuy(now);
  }
  if (active && cashOpen) {
    if (held > 0n) {
      if (!trading) log("WARN", "vault holds stock but no swap adapter is set; cannot flatten");
      else await vaultFlatten(held);
    } else {
      await write("vault: end cycle", D.vault, vaultAbi, "endCycle");
    }
  }
}

const ZERO = "0x0000000000000000000000000000000000000000";
const execPx = (usdg6, stockRaw) => (stockRaw === 0n ? 0n : (usdg6 * 10n ** 12n * 10n ** 18n) / stockRaw);
const fmtUsd = (wad) => `$${(Number(wad / 10n ** 14n) / 1e4).toFixed(2)}`;

/** Simulate a vault trade as the keeper; returns the amount out, or null with the revert reason. */
async function simVault(fn, args) {
  try {
    const { result } = await pub.simulateContract({ address: D.vault, abi: vaultAbi, functionName: fn, args, account: account?.address ?? env("KEEPER_ADDRESS", undefined) });
    return { out: result };
  } catch (e) {
    return { err: reason(e) };
  }
}

/**
 * Buy the vault's stock during Vespers, but only when the pool sells it at least VAULT_MIN_EDGE_BPS
 * below the oracle mark (that discount is what LPs are paid for carrying the weekend risk). Up to
 * VAULT_TARGET_BPS of NAV (and VAULT_MAX_USDG), at most one chunk per tick, never in the last
 * VAULT_BUY_CUTOFF_MIN minutes before the open. The contract still enforces its own 50%-of-NAV
 * cap and the 50 bps band around the mark.
 */
async function vaultBuy(now) {
  const [inv, maxInvBps, nextOpen] = await Promise.all([
    read(D.vault, vaultAbi, "inventory"),
    read(D.vault, vaultAbi, "maxInventoryBps"),
    read(D.oracle, oracleAbi, "nextOpenAfter", [now]),
  ]);
  const [usdgFree, , stockValue, nav, mark, frozen] = inv;
  if (frozen) return note("vault-buy", "INFO", "vault: not buying: mark frozen");
  if (Number(nextOpen - now) < VAULT_BUY_CUTOFF_MIN * 60) return;
  let target = (nav * (VAULT_TARGET_BPS < maxInvBps ? VAULT_TARGET_BPS : maxInvBps)) / 10_000n;
  if (VAULT_MAX_USDG) {
    const cap = BigInt(Math.round(Number(VAULT_MAX_USDG) * 1e6));
    if (cap < target) target = cap;
  }
  const room = target > stockValue ? target - stockValue : 0n;
  if (room < 1_000_000n) return; // under 1 USDG left to fill
  let size = room < VAULT_CHUNK_USDG ? room : VAULT_CHUNK_USDG;
  if (size > usdgFree) size = usdgFree;
  // Smaller sizes move the pool less, so a big chunk without edge may still work at a quarter.
  let why = "size under 1 USDG";
  for (const s of [size, size / 2n, size / 4n]) {
    if (s < 1_000_000n) break;
    const sim = await simVault("buyInventory", [s, 0n]);
    if (sim.err) {
      why = sim.err;
      continue;
    }
    const px = execPx(s, sim.out);
    const edgeBps = ((mark - px) * 10_000n) / mark;
    if (edgeBps < VAULT_MIN_EDGE_BPS) {
      why = `no discount: pool ${fmtUsd(px)} vs mark ${fmtUsd(mark)} (${edgeBps} bps, need ${VAULT_MIN_EDGE_BPS})`;
      continue;
    }
    const minOut = (sim.out * (10_000n - SLIPPAGE_BPS)) / 10_000n;
    await write(`vault: buy ${fmtUsdg(s)} USDG of stock at ${fmtUsd(px)}, ${edgeBps} bps under the mark ${fmtUsd(mark)}`, D.vault, vaultAbi, "buyInventory", [s, minOut]);
    notes.delete("vault-buy");
    return;
  }
  note("vault-buy", "INFO", `vault: not buying: ${why}`);
}

/**
 * At the open, once the mark is fresh: sell everything, or in halves if a full sell would land
 * outside the contract's 50 bps band (a thin pool). Endcycle follows on a later tick when flat.
 */
async function vaultFlatten(held) {
  let why = "";
  for (const amt of [held, held / 2n, held / 4n, held / 8n]) {
    if (amt === 0n) break;
    const sim = await simVault("sellInventory", [amt, 0n]);
    if (sim.err) {
      why = sim.err;
      continue;
    }
    const minOut = (sim.out * (10_000n - SLIPPAGE_BPS)) / 10_000n;
    await write(`vault: sell ${amt === held ? "all" : "part of the"} stock for ${fmtUsdg(sim.out)} USDG`, D.vault, vaultAbi, "sellInventory", [amt, minOut]);
    notes.delete("vault-sell");
    return;
  }
  // Right after the bell the mark is still Friday's (STALE) until the first print; that's expected.
  note("vault-sell", "INFO", `vault: can't flatten yet (${why})`);
}

// ───────────────────────────── loop ─────────────────────────────

async function tick() {
  const block = await pub.getBlock();
  const now = block.timestamp;
  state.ticks++;
  let stocks = [];
  try {
    stocks = await listedStocks();
  } catch (e) {
    log("ERROR", `listing stocks: ${reason(e)}`);
  }
  for (const [name, fn] of [
    ["record close", () => jobRecordClose(now, stocks)],
    ["markets", async () => {
      const markets = await recentMarkets(Math.max(50, stocks.length * 4));
      await jobCreateMarket(now, markets, stocks);
      await jobSettle(now, await recentMarkets(Math.max(50, stocks.length * 4)));
    }],
    ["vault", () => jobVault(now)],
    ["gas", () => checkGas()],
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
    const stocks = await listedStocks();
    log("INFO", "keeper starting", { chainId, keeper: account.address, isKeeperOracle, isKeeperMarket, ethBalanceWei: bal, dryRun: DRY_RUN, schedule: MARKET_SCHEDULE, tickers: stocks.map((x) => x.symbol).join(",") });
    if (!isKeeperMarket) log("WARN", "this wallet is not a keeper on AmenMarket: market creation will be skipped (closes, resolves and voids are permissionless)");
    alert("INFO", `Keeper started: ${stocks.map((x) => x.symbol).join(", ") || "no tickers"} · ${Number(formatEther(bal)).toFixed(4)} ETH for gas${VAULT_TRADING ? " · vault trading on" : ""}`);
  } else {
    log("INFO", "keeper starting in DRY_RUN without a key (read + simulate only)", { chainId });
  }
  if (alertsOn()) log("INFO", `alerts on: ${[ALERT_DISCORD_WEBHOOK && "Discord", ALERT_TELEGRAM_BOT_TOKEN && "Telegram"].filter(Boolean).join(" + ")} (level ${ALERT_LEVEL})`);

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
