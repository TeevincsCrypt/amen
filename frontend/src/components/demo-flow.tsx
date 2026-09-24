"use client";

import { useCallback, useState } from "react";
import { useBlock, usePublicClient, useReadContracts } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { createWalletClient, http, maxUint256, type Abi, type Address } from "viem";
import { activeChain } from "@/lib/chains";
import { amenMarketAbi, amenOracleAbi, mockAggregatorAbi, mockSwapAdapterAbi, stockTokenAbi, usdgAbi, vespersVaultAbi } from "@/lib/contracts";
import { ACCOUNTS, DEMO, MARKET_ID, SESSION_ID, T } from "@/lib/demo";
import { decodeError } from "@/lib/errors";
import { fmt18, fmtNy, fmtUsd18, fmtUsdg } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, Play, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

type Who = keyof typeof ACCOUNTS;
type Call = { address: Address; abi: Abi | readonly unknown[]; functionName: string; args?: readonly unknown[] };

const wallet = createWalletClient({ chain: activeChain, transport: http(activeChain.rpcUrls.default.http[0]) });

async function rpc(method: string, params: unknown[] = []) {
  const res = await fetch(activeChain.rpcUrls.default.http[0], {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

type Market = { yesPool: bigint; noPool: bigint; resolved: boolean; yesWins: boolean; voided: boolean; resolvePrice: bigint; resolveMarkTs: bigint; moveBps: bigint; takerFeeBps: bigint };
type Pos = { yes: bigint; no: bigint; claimed: boolean };
type Cycle = { navStart: bigint; navEnd: bigint; realizedPnl: bigint; perfFee: bigint; endTs: bigint };
type Mark = { priceUsd: bigint; updatedAt: bigint; roundId: bigint };

/**
 * The local demo as one ordered list of buttons, in the same order as script/local-demo.sh.
 * Transactions are sent as anvil's unlocked dev accounts (owner, user1, user2), so no wallet is
 * needed. Each step's "done" state is read from the chain, so a page refresh never loses its place.
 */
export function DemoFlow() {
  const client = usePublicClient();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string>();
  const [log, setLog] = useState<{ ok: boolean; text: string }[]>([]);
  const { data: block } = useBlock({ watch: true, query: { refetchInterval: 2_000 } });
  const now = block ? Number(block.timestamp) : 0;

  const M = { address: DEMO.market, abi: amenMarketAbi } as const;
  const V = { address: DEMO.vault, abi: vespersVaultAbi } as const;
  const { data } = useReadContracts({
    contracts: [
      { address: DEMO.oracle, abi: amenOracleAbi, functionName: "hasOfficialClose", args: [DEMO.nvda, SESSION_ID] },
      { address: DEMO.oracle, abi: amenOracleAbi, functionName: "officialClose", args: [DEMO.nvda, SESSION_ID] },
      { ...M, functionName: "marketCount" },
      { ...M, functionName: "getMarket", args: [MARKET_ID] },
      { ...M, functionName: "positionOf", args: [MARKET_ID, ACCOUNTS.user1] },
      { ...M, functionName: "positionOf", args: [MARKET_ID, ACCOUNTS.user2] },
      { ...M, functionName: "claimable", args: [MARKET_ID, ACCOUNTS.user2] },
      { ...V, functionName: "balanceOf", args: [ACCOUNTS.owner] },
      { ...V, functionName: "currentCycleId" },
      { ...V, functionName: "stockHeld" },
      { ...V, functionName: "cycles", args: [1n] },
      { address: DEMO.nvdaFeed, abi: mockAggregatorAbi, functionName: "latestRoundData" },
      { ...M, functionName: "accruedFees" },
    ],
    query: { refetchInterval: 2_000 },
  });
  const r = <X,>(i: number) => data?.[i]?.result as X | undefined;
  const closeRecorded = !!r<boolean>(0);
  const close = r<Mark>(1);
  const marketCount = r<bigint>(2) ?? 0n;
  const mk = r<Market>(3);
  const p1 = r<Pos>(4);
  const p2 = r<Pos>(5);
  const u2Claimable = r<bigint>(6) ?? 0n;
  const ownerShares = r<bigint>(7) ?? 0n;
  const cycleId = r<bigint>(8) ?? 0n;
  const stockHeld = r<bigint>(9) ?? 0n;
  const cyc = r<Cycle>(10);
  const feedRound = r<readonly [bigint, bigint, bigint, bigint, bigint]>(11);
  const fees = r<bigint>(12);
  const hasMarket = marketCount >= MARKET_ID;
  const total = (mk?.yesPool ?? 0n) + (mk?.noPool ?? 0n);
  const u1Payout = mk && mk.resolved && mk.yesWins && mk.yesPool > 0n && p1 ? (p1.yes * (total - (total * mk.takerFeeBps) / 10000n)) / mk.yesPool : 0n;

  const send = useCallback(
    async (label: string, who: Who, calls: Call[]) => {
      setBusy(label);
      try {
        for (const c of calls) {
          const hash = await wallet.writeContract({ ...(c as object), account: ACCOUNTS[who], chain: activeChain } as never);
          const rc = await client!.waitForTransactionReceipt({ hash });
          if (rc.status !== "success") throw new Error(`${c.functionName} reverted`);
        }
        setLog((l) => [{ ok: true, text: `✓ ${label}` }, ...l].slice(0, 6));
      } catch (e) {
        setLog((l) => [{ ok: false, text: `✗ ${label}: ${decodeError(e)}` }, ...l].slice(0, 6));
      } finally {
        setBusy(undefined);
        await qc.invalidateQueries();
      }
    },
    [client, qc],
  );

  const warp = async (label: string, ts: number) => {
    setBusy(label);
    try {
      await rpc("evm_setNextBlockTimestamp", [ts]);
      await rpc("evm_mine");
      setLog((l) => [{ ok: true, text: `✓ ${label}` }, ...l].slice(0, 6));
    } catch (e) {
      setLog((l) => [{ ok: false, text: `✗ ${label}: ${decodeError(e)}` }, ...l].slice(0, 6));
    } finally {
      setBusy(undefined);
      await qc.invalidateQueries();
    }
  };

  /**
   * Revert to the latest Friday-16:02 snapshot, then take a fresh one for next time.
   * Only Friday-state snapshots are kept on the demo chain (by the script and by this button),
   * and each is the newest when taken. A probe snapshot reveals the current id N, so the Friday
   * snapshot is N−1. Never try an older, unknown id: on anvil a revert to a missing id still
   * deletes every newer snapshot, which would destroy the Friday state for everyone.
   */
  const rewind = async () => {
    setBusy("Rewind");
    try {
      const probe = BigInt(await rpc("evm_snapshot"));
      let ok = false;
      for (let id = probe - 1n; id >= 0n && id >= probe - 8n && !ok; id--) {
        ok = await rpc("evm_revert", [`0x${id.toString(16)}`]);
      }
      if (!ok) throw new Error("no Friday snapshot left on this chain: restart the demo chain");
      const latest = await client!.getBlock();
      await rpc("evm_setNextBlockTimestamp", [Number(latest.timestamp) + 1]);
      await rpc("evm_mine");
      await rpc("evm_snapshot");
      setLog([{ ok: true, text: "✓ Rewound to Friday 16:02 New York (Vespers)" }]);
    } catch (e) {
      setLog((l) => [{ ok: false, text: `✗ Rewind: ${decodeError(e)}` }, ...l]);
    } finally {
      setBusy(undefined);
      await qc.invalidateQueries();
    }
  };

  const approve = (token: Address, spender: Address): Call => ({ address: token, abi: usdgAbi, functionName: "approve", args: [spender, maxUint256] });
  const printed = !!feedRound && Number(feedRound[3]) >= T.mondayOpen;

  const steps: { n: number; who: string; title: string; detail: string; done: boolean; action: () => void; disabledNote?: string }[] = [
    {
      n: 1, who: "anyone", title: "Record official close",
      detail: "Last Chainlink round at or before Friday's 16:00 bell, within 30 minutes.",
      done: closeRecorded,
      action: () => send("Record official close", "owner", [{ address: DEMO.oracle, abi: amenOracleAbi, functionName: "recordSessionClose", args: [DEMO.nvda] }]),
    },
    {
      n: 2, who: "owner", title: "Create NVDA 1% gap market",
      detail: "YES if |Monday open print ÷ Friday close − 1| ≥ 1.00%. Resolves at the next open.",
      done: hasMarket,
      action: () => send("Create gap market", "owner", [{ ...M, functionName: "createGapMarket", args: [DEMO.nvda, SESSION_ID, 100n, 0n, 10_000_000_000n] }]),
    },
    {
      n: 3, who: "user1", title: "User1 buys 100 USDG YES", detail: "Parimutuel stake; max loss is the stake.",
      done: (p1?.yes ?? 0n) >= 100_000_000n,
      action: () => send("User1 buys YES 100", "user1", [approve(DEMO.usdg, DEMO.market), { ...M, functionName: "buy", args: [MARKET_ID, true, 100_000_000n] }]),
    },
    {
      n: 4, who: "user2", title: "User2 buys 300 USDG NO", detail: "Takes the other side of the overnight gap.",
      done: (p2?.no ?? 0n) >= 300_000_000n,
      action: () => send("User2 buys NO 300", "user2", [approve(DEMO.usdg, DEMO.market), { ...M, functionName: "buy", args: [MARKET_ID, false, 300_000_000n] }]),
    },
    {
      n: 5, who: "owner", title: "Owner deposits 100 USDG into Vespers", detail: "The vault is flat, so NAV is exact USDG.",
      done: ownerShares > 0n,
      action: () => send("Deposit 100 USDG", "owner", [approve(DEMO.usdg, DEMO.vault), { ...V, functionName: "deposit", args: [100_000_000n, ACCOUNTS.owner] }]),
    },
    {
      n: 6, who: "keeper", title: "Start cycle + buy 40 USDG of NVDA", detail: "Inventory only during Vespers, ≤ 50% NAV, within 50 bps of the mark ($180).",
      done: cycleId >= 1n,
      action: () => send("Start cycle + buy inventory", "owner", [{ ...V, functionName: "startCycle" }, { ...V, functionName: "buyInventory", args: [40_000_000n, 0n] }]),
    },
    {
      n: 7, who: "time", title: "Warp to Monday 09:45 New York", detail: "Cash opens. The feed is still Friday's, so Amen shows FROZEN · STALE until the next print.",
      done: now >= T.monday,
      action: () => warp("Warp to Monday 09:45 NY", Math.max(T.monday, now + 1)),
    },
    {
      n: 8, who: "feed", title: "Mock feed prints $182.00 (YES)", detail: "+1.11% vs the $180 close. The mock swap venue moves with it.",
      done: printed,
      action: () =>
        send("Print $182.00", "owner", [
          { address: DEMO.nvdaFeed, abi: mockAggregatorAbi, functionName: "setAnswer", args: [18_200_000_000n] },
          { address: DEMO.mockVenue, abi: mockSwapAdapterAbi, functionName: "setPrice", args: [182n * 10n ** 18n] },
        ]),
    },
    {
      n: 9, who: "anyone", title: "Resolve", detail: "Uses the first cash-session print at or after 09:30, proven by round id.",
      done: !!mk?.resolved || !!mk?.voided,
      action: () => send("Resolve", "owner", [{ ...M, functionName: "resolve", args: [MARKET_ID] }]),
    },
    {
      n: 10, who: "user1", title: "User1 claims", detail: "400 × (1 − 1% fee) ÷ 100 YES = 3.96× → 396 USDG.",
      done: !!p1?.claimed,
      action: () => send("User1 claims", "user1", [{ ...M, functionName: "claim", args: [MARKET_ID] }]),
    },
    {
      n: 11, who: "user2", title: "User2 claims",
      detail: u2Claimable > 0n ? `Claimable ${fmtUsdg(u2Claimable)} USDG.` : "NO lost, so there is nothing to claim. The contract would revert NothingToClaim.",
      done: !!p2?.claimed || (!!mk?.resolved && u2Claimable === 0n),
      disabledNote: mk?.resolved && u2Claimable === 0n ? "nothing to claim" : undefined,
      action: () => send("User2 claims", "user2", [{ ...M, functionName: "claim", args: [MARKET_ID] }]),
    },
    {
      n: 12, who: "keeper", title: "Flatten vault + end cycle", detail: "Sells NVDA at $182 (within 50 bps of the mark), books realized PnL, accrues a 10% perf fee.",
      done: !!cyc && cyc.endTs > 0n,
      action: () => send("Flatten + end cycle", "owner", [...(stockHeld > 0n ? [{ ...V, functionName: "flatten", args: [0n] } as Call] : []), { ...V, functionName: "endCycle" }]),
    },
  ];
  const nextIdx = steps.findIndex((s) => !s.done);
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card className="min-w-0 xl:col-span-2">
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">Live demo · chain 31337 · mocks only</p>
            <CardTitle className="text-lg">Friday close → Monday open, in twelve clicks</CardTitle>
            <CardDescription>
              Transactions are sent as the demo chain&apos;s dev accounts (owner #0, user1 #1, user2 #2). No wallet is needed.
              Chain time: {now ? fmtNy(now) : "—"}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={rewind}>
              <RotateCcw className="h-3.5 w-3.5" /> Rewind to Friday 16:02
            </Button>
            <Button size="sm" disabled={!!busy || nextIdx < 0} onClick={() => nextIdx >= 0 && steps[nextIdx].action()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {nextIdx < 0 ? "All done" : `Run step ${steps[nextIdx].n}`}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              {doneCount}/{steps.length}
            </span>
          </div>
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="hidden grid-cols-[2.5rem_5rem_1fr_6rem] gap-3 border-b border-border bg-card-raised px-4 py-2 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground sm:grid">
              <span>Step</span>
              <span>Actor</span>
              <span>Action</span>
              <span className="text-right">Status</span>
            </div>
            {steps.map((s, i) => (
              <div
                key={s.n}
                className={cn(
                  "grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 sm:grid-cols-[2.5rem_5rem_1fr_6rem]",
                  i === nextIdx && "bg-primary/[0.06]",
                )}
              >
                <span className={cn("font-mono text-sm", i === nextIdx ? "text-primary" : "text-muted-foreground")}>{String(s.n).padStart(2, "0")}</span>
                <span className="hidden font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground sm:block">{s.who}</span>
                <div className="min-w-0">
                  <div className={cn("text-sm", s.done && "text-muted-foreground")}>{s.title}</div>
                  <div className="text-xs text-muted-foreground">{s.detail}</div>
                </div>
                <div className="flex justify-end">
                  {s.done ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-up" />
                      {s.disabledNote ?? "done"}
                    </span>
                  ) : (
                    <Button size="sm" variant={i === nextIdx ? "default" : "outline"} disabled={!!busy || !!s.disabledNote} onClick={s.action}>
                      {busy && i === nextIdx ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Run"}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {log.length > 0 && (
            <div className="space-y-1 rounded-lg border border-border bg-card-raised p-3 font-mono text-[11px]">
              {log.map((l, i) => (
                <div key={i} className={l.ok ? "text-muted-foreground" : "text-destructive"}>
                  {l.text}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid content-start gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Demo summary</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            <Row k="Close mark" v={closeRecorded && close ? `${fmtUsd18(close.priceUsd)} · round ${close.roundId}` : "not recorded"} />
            <Row k="Pools" v={hasMarket && mk ? `YES ${fmtUsdg(mk.yesPool)} · NO ${fmtUsdg(mk.noPool)} USDG` : "—"} />
            <Row
              k="Resolve mark"
              v={mk?.resolved ? `${fmtUsd18(mk.resolvePrice)} · ${(Number(mk.moveBps) / 100).toFixed(2)}% → ${mk.yesWins ? "YES" : "NO"}` : mk?.voided ? "voided (refunds)" : "—"}
            />
            <Row k="Claims" v={mk?.resolved ? `user1 ${p1?.claimed ? "claimed" : "can claim"} ${fmtUsdg(u1Payout)} USDG` : "—"} />
            <Row k="Taker fee" v={fees !== undefined ? `${fmtUsdg(fees, 6)} USDG` : "—"} />
            <Row
              k="Vault cycle #1"
              v={cyc && cyc.endTs > 0n ? `PnL ${fmtUsdg(cyc.realizedPnl, 6)} · fee ${fmtUsdg(cyc.perfFee, 6)} USDG` : cycleId >= 1n ? `open · NVDA ${fmt18(stockHeld, 4)}` : "—"}
            />
          </CardContent>
        </Card>
        <DemoBalances />
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-[13px]">
      <span className="shrink-0 font-mono text-xs text-muted-foreground">{k}</span>
      <span className="text-right font-mono text-xs text-foreground">{v}</span>
    </div>
  );
}

/** Raw NVDA and share-equivalent (balanceOfUI) for each demo account. Raw balanceOf is not a share count. */
function DemoBalances() {
  const who = Object.entries(ACCOUNTS) as [Who, Address][];
  const { data } = useReadContracts({
    contracts: who.flatMap(([, a]) => [
      { address: DEMO.usdg, abi: usdgAbi, functionName: "balanceOf", args: [a] },
      { address: DEMO.nvda, abi: stockTokenAbi, functionName: "balanceOf", args: [a] },
      { address: DEMO.nvda, abi: stockTokenAbi, functionName: "balanceOfUI", args: [a] },
    ]),
    query: { refetchInterval: 2_000 },
  });
  const v = (i: number) => data?.[i]?.result as bigint | undefined;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>Demo accounts</CardTitle>
        <CardDescription>NVDA raw is the Stock Token balanceOf (18 dec). Share-equiv. is balanceOfUI (raw × uiMultiplier): economic exposure only, not share ownership.</CardDescription>
      </CardHeader>
      <CardContent>
        <table className="w-full font-mono text-xs tabular-nums">
          <thead className="text-left font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="py-1">Account</th>
              <th className="text-right">USDG</th>
              <th className="text-right">NVDA raw</th>
              <th className="text-right">Share-equiv.</th>
            </tr>
          </thead>
          <tbody>
            {who.map(([name, a], i) => (
              <tr key={name} className="border-t border-border">
                <td className="py-2">
                  {name} <span className="text-muted-foreground">{a.slice(0, 6)}…</span>
                </td>
                <td className="text-right">{fmtUsdg(v(i * 3))}</td>
                <td className="text-right">{fmt18(v(i * 3 + 1), 4)}</td>
                <td className="text-right">{fmt18(v(i * 3 + 2), 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
