"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { amenMarketAbi, amenOracleAbi, deployment, vespersVaultAbi } from "@/lib/contracts";
import { useBlockTs, useChainNow, useRoundHistory, useSession, useStock, type Stock } from "@/lib/hooks";
import { bytes32ToString, fmt18, fmtAge, fmtBps, fmtNyDay, fmtNyShort, fmtUsd18, fmtUsdg } from "@/lib/format";
import { isLocal } from "@/lib/chains";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Figure, Stat } from "@/components/stat";
import { SessionChip } from "@/components/session-chip";
import { SplitBar } from "@/components/split-bar";
import { RoundsChart } from "@/components/app/rounds-chart";
import { PageHeader } from "@/components/app/page-header";
import { NoDeployment } from "@/components/no-deployment";
import { DemoFlow } from "@/components/demo-flow";
import { cn } from "@/lib/utils";

type Market = {
  id: bigint;
  stockToken: Address;
  strikeBps: bigint;
  closeMarkPrice: bigint;
  resolveEarliestTs: bigint;
  endTs: bigint;
  yesPool: bigint;
  noPool: bigint;
  resolved: boolean;
  yesWins: boolean;
  voided: boolean;
  resolveReason: `0x${string}`;
};

export default function OverviewPage() {
  if (!deployment) return <NoDeployment />;
  return <Overview />;
}

function Overview() {
  const s = useSession();
  const [picked, setPicked] = useState<Address>();
  const selected = s.stocks.find((x) => x.token === picked) ?? s.stocks[0];

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Overview" title="Stock Tokens, after hours" />

      <TickerStrip stocks={s.stocks} selected={selected?.token} onSelect={setPicked} />

      <div className="grid gap-4 xl:grid-cols-3">
        <TickerCard stock={selected} />
        <div className="grid min-w-0 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>US cash session</CardTitle>
            </CardHeader>
            <CardContent>
              <SessionChip large />
            </CardContent>
          </Card>
          <OfficialCloseCard stock={selected} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <VaultCard />
        <LatestMarketsCard />
      </div>

      {isLocal && <DemoFlow />}
    </div>
  );
}

/** Every listed ticker as a selectable tile (price + feed status). */
function TickerStrip({ stocks, selected, onSelect }: { stocks: Stock[]; selected?: Address; onSelect: (t: Address) => void }) {
  if (stocks.length === 0) return null;
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
      {stocks.map((st) => (
        <button
          key={st.token}
          onClick={() => onSelect(st.token)}
          aria-pressed={st.token === selected}
          className={cn(
            "min-w-[9.5rem] shrink-0 rounded-xl border bg-card px-4 py-3 text-left transition-colors hover:border-primary/40",
            st.token === selected ? "border-primary/60 bg-primary/[0.06]" : "border-border",
          )}
        >
          <span className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">{st.symbol}</span>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 font-mono text-[9.5px] uppercase",
                st.mark?.frozen ? "bg-destructive/10 text-destructive" : "bg-up/10 text-up",
              )}
            >
              {st.mark ? (st.mark.frozen ? st.mark.freezeReason || "frozen" : "live") : "…"}
            </span>
          </span>
          <span className="mt-1 block font-mono text-base tabular-nums">{fmtUsd18(st.mark?.priceUsd)}</span>
          <span className="block text-[10.5px] text-muted-foreground">{st.allowed ? "markets open" : "markets off"}</span>
        </button>
      ))}
    </div>
  );
}

function TickerCard({ stock }: { stock?: Stock }) {
  const now = useChainNow();
  const { points } = useRoundHistory(stock?.token, 48);
  const m = stock?.mark;
  const age = m && now ? now - Number(m.updatedAt) : undefined;
  return (
    <Card className="min-w-0 xl:col-span-2">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-4 pb-2">
        <div>
          <p className="text-xs text-muted-foreground">{stock?.symbol ?? "—"} / USD · Chainlink mark</p>
          <Figure text={fmtUsd18(m?.priceUsd)} className="mt-1 block text-5xl" />
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">
            round {m?.roundId.toString() ?? "—"} · updated {age !== undefined ? fmtAge(age) : "—"} · normalized to 18 dec
          </p>
        </div>
        {m?.frozen ? (
          <Badge variant="frozen">
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {stock?.symbol} frozen · {m.freezeReason}
          </Badge>
        ) : (
          <SessionChip />
        )}
      </CardHeader>
      <CardContent className="pt-2">{now !== undefined && <RoundsChart points={points} now={now} symbol={stock?.symbol ?? ""} />}</CardContent>
    </Card>
  );
}

function OfficialCloseCard({ stock }: { stock?: Stock }) {
  const d = deployment!;
  const ts = useBlockTs();
  const { data: last } = useReadContract({
    address: d.oracle,
    abi: amenOracleAbi,
    functionName: "lastCloseAt",
    args: ts ? [ts] : undefined,
    query: { enabled: !!ts },
  });
  const { data: closeReads } = useReadContracts({
    contracts:
      last !== undefined && stock
        ? [
            { address: d.oracle, abi: amenOracleAbi, functionName: "hasOfficialClose", args: [stock.token, last[0]] },
            { address: d.oracle, abi: amenOracleAbi, functionName: "officialClose", args: [stock.token, last[0]] },
          ]
        : [],
    query: { enabled: last !== undefined && !!stock, refetchInterval: 4_000 },
  });
  const recorded = closeReads?.[0]?.result as boolean | undefined;
  const close = closeReads?.[1]?.result as { priceUsd: bigint; updatedAt: bigint } | undefined;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>Official close · {stock?.symbol ?? "—"}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4">
        <Stat label="Close mark" value={recorded ? fmtUsd18(close?.priceUsd) : "Not recorded"} unit={recorded ? `feed @ ${fmtNyShort(close?.updatedAt)}` : "USD · 18 dec"} />
        <Stat
          label="Session"
          value={last ? new Date(Number(last[1]) * 1000).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" }) : "—"}
          unit={last ? `16:00 close · id ${last[0].toString()}` : undefined}
        />
      </CardContent>
    </Card>
  );
}

function VaultCard() {
  const d = deployment!;
  const V = { address: d.vault, abi: vespersVaultAbi } as const;
  const { data } = useReadContracts({
    contracts: [
      { ...V, functionName: "inventory" },
      { ...V, functionName: "convertToAssets", args: [10n ** 18n] },
      { ...V, functionName: "currentCycleId" },
      { ...V, functionName: "cycleActive" },
      { ...V, functionName: "stock" },
    ],
    query: { refetchInterval: 4_000 },
  });
  const inv = data?.[0]?.result as readonly [bigint, bigint, bigint, bigint, bigint, boolean, `0x${string}`] | undefined;
  const sharePrice = data?.[1]?.result as bigint | undefined;
  const cycleId = data?.[2]?.result as bigint | undefined;
  const cycleActive = data?.[3]?.result as boolean | undefined;
  const vaultStock = useStock(data?.[4]?.result as Address | undefined);
  const sym = vaultStock?.symbol ?? "…";
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between pb-3">
        <div>
          <CardTitle>Vespers Vault</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {sym} / USDG · cycle {cycleId?.toString() ?? "—"} {cycleActive ? "· active" : "· idle"}
          </p>
        </div>
        <Link href="/app/vault" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          Open <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <p className="text-xs text-muted-foreground">Net asset value</p>
            <Figure text={fmtUsdg(inv?.[3])} className="mt-1 block text-3xl" />
            <p className="font-mono text-[10.5px] text-muted-foreground">USDG · 6 dec</p>
          </div>
          <Stat label="Share price" value={fmtUsdg(sharePrice, 6)} unit="USDG per vault share" />
          <Stat label={`${sym} held`} value={fmt18(inv?.[1], 4)} unit={`raw ${sym} · 18 dec`} />
        </div>
        <SplitBar
          segments={[
            { label: "USDG", value: Number(inv?.[0] ?? 0n), display: `${fmtUsdg(inv?.[0])} USDG`, color: "s1" },
            { label: sym, value: Number(inv?.[2] ?? 0n), display: `${fmtUsdg(inv?.[2])} USDG`, color: "s2" },
          ]}
        />
      </CardContent>
    </Card>
  );
}

/** The latest markets across every ticker. */
function LatestMarketsCard() {
  const d = deployment!;
  const now = useChainNow();
  const { stocks } = useSession();
  const M = { address: d.market, abi: amenMarketAbi } as const;
  const { data: count } = useReadContract({ ...M, functionName: "marketCount", query: { refetchInterval: 4_000 } });
  const n = Number(count ?? 0n);
  const ids = Array.from({ length: Math.min(n, 5) }, (_, i) => BigInt(n - i));
  const { data } = useReadContracts({
    contracts: ids.map((id) => ({ ...M, functionName: "getMarket" as const, args: [id] as const })),
    query: { enabled: ids.length > 0, refetchInterval: 4_000 },
  });
  const markets = (data ?? []).map((r) => r.result as Market | undefined).filter((m): m is Market => !!m);
  const sym = (t: Address) => stocks.find((s) => s.token.toLowerCase() === t.toLowerCase())?.symbol ?? t.slice(0, 6);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between pb-3">
        <div>
          <CardTitle>Amen Market</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {n} market{n === 1 ? "" : "s"} · {stocks.filter((s) => s.allowed).length} tickers
          </p>
        </div>
        <Link href="/app/markets" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          All markets <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </CardHeader>
      <CardContent>
        {markets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No markets yet.
            {isLocal
              ? " The demo chain starts at Friday 16:02 New York. Run steps 1–2 of the demo below to create the NVDA market."
              : " New gap markets open after Friday's 16:00 New York close."}
          </p>
        ) : (
          <div className="divide-y divide-border">
            {markets.map((m) => {
              const total = m.yesPool + m.noPool;
              const yesPct = total > 0n ? Number((m.yesPool * 1000n) / total) / 10 : 50;
              const status = m.voided
                ? { label: `Voided · ${bytes32ToString(m.resolveReason).replace("_", " ")}`, v: "frozen" as const }
                : m.resolved
                  ? { label: m.yesWins ? "YES won" : "NO won", v: "brand" as const }
                  : now !== undefined && now < Number(m.endTs)
                    ? { label: "Trading", v: "cash" as const }
                    : { label: "Awaiting resolve", v: "vespers" as const };
              return (
                <Link key={m.id.toString()} href="/app/markets" className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-3 py-2.5 hover:opacity-90">
                  <span className="text-sm font-semibold">{sym(m.stockToken)}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px]">
                      #{m.id.toString()} · gap ≥ {fmtBps(m.strikeBps)} from {fmtUsd18(m.closeMarkPrice)}
                    </span>
                    <span className="mt-1 flex h-1.5 gap-[2px] overflow-hidden rounded-full" title={`YES ${fmtUsdg(m.yesPool)} · NO ${fmtUsdg(m.noPool)} USDG`}>
                      <span className="bg-s1" style={{ width: `${yesPct}%` }} />
                      <span className="bg-s2" style={{ width: `${100 - yesPct}%` }} />
                    </span>
                    <span className="mt-1 block font-mono text-[10.5px] text-muted-foreground">
                      YES {fmtUsdg(m.yesPool)} · NO {fmtUsdg(m.noPool)} USDG · resolves {fmtNyDay(m.resolveEarliestTs)} {fmtNyShort(m.resolveEarliestTs)}
                    </span>
                  </span>
                  <Badge variant={status.v}>{status.label}</Badge>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
