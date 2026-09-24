"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useReadContract, useReadContracts } from "wagmi";
import { amenMarketAbi, amenOracleAbi, deployment, vespersVaultAbi } from "@/lib/contracts";
import { useBlockTs, useChainNow, useRoundHistory, useSession } from "@/lib/hooks";
import { bytes32ToString, fmt18, fmtAge, fmtBps, fmtNy, fmtNyDay, fmtNyShort, fmtUsd18, fmtUsdg } from "@/lib/format";
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

type Market = {
  id: bigint;
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
  resolvePrice: bigint;
  moveBps: bigint;
};

export default function OverviewPage() {
  if (!deployment) return <NoDeployment />;
  return <Overview />;
}

function Overview() {
  const d = deployment!;
  const s = useSession();
  const now = useChainNow();
  const ts = useBlockTs();
  const { points } = useRoundHistory(48);
  const age = s.markUpdatedAt && now ? now - Number(s.markUpdatedAt) : undefined;

  const V = { address: d.vault, abi: vespersVaultAbi } as const;
  const M = { address: d.market, abi: amenMarketAbi } as const;
  const { data } = useReadContracts({
    contracts: [
      { ...V, functionName: "inventory" },
      { ...V, functionName: "convertToAssets", args: [10n ** 18n] },
      { ...V, functionName: "currentCycleId" },
      { ...V, functionName: "cycleActive" },
      { ...M, functionName: "marketCount" },
    ],
    query: { refetchInterval: 4_000 },
  });
  const inv = data?.[0]?.result as readonly [bigint, bigint, bigint, bigint, bigint, boolean, `0x${string}`] | undefined;
  const sharePrice = data?.[1]?.result as bigint | undefined;
  const cycleId = data?.[2]?.result as bigint | undefined;
  const cycleActive = data?.[3]?.result as boolean | undefined;
  const count = (data?.[4]?.result as bigint | undefined) ?? 0n;

  const { data: mk } = useReadContract({ ...M, functionName: "getMarket", args: [count], query: { enabled: count > 0n, refetchInterval: 4_000 } });
  const m = mk as Market | undefined;

  const { data: last } = useReadContract({
    address: d.oracle,
    abi: amenOracleAbi,
    functionName: "lastCloseAt",
    args: ts ? [ts] : undefined,
    query: { enabled: !!ts },
  });
  const { data: closeReads } = useReadContracts({
    contracts:
      last !== undefined
        ? [
            { address: d.oracle, abi: amenOracleAbi, functionName: "hasOfficialClose", args: [d.nvda, last[0]] },
            { address: d.oracle, abi: amenOracleAbi, functionName: "officialClose", args: [d.nvda, last[0]] },
          ]
        : [],
    query: { enabled: last !== undefined, refetchInterval: 4_000 },
  });
  const recorded = closeReads?.[0]?.result as boolean | undefined;
  const close = closeReads?.[1]?.result as { priceUsd: bigint; updatedAt: bigint } | undefined;

  const mStatus = !m
    ? null
    : m.voided
      ? { label: `Voided · ${bytes32ToString(m.resolveReason)}`, v: "frozen" as const }
      : m.resolved
        ? { label: `Resolved · ${m.yesWins ? "YES" : "NO"}`, v: "brand" as const }
        : now !== undefined && now < Number(m.endTs)
          ? { label: "Trading", v: "cash" as const }
          : { label: "Awaiting resolve", v: "vespers" as const };

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Overview" title="NVDA, after hours" />

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="min-w-0 xl:col-span-2">
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-4 pb-2">
            <div>
              <p className="text-xs text-muted-foreground">NVDA / USD · Chainlink mark</p>
              <Figure text={fmtUsd18(s.markPrice)} className="mt-1 block text-5xl" />
              <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                round {s.markRoundId?.toString() ?? "—"} · updated {age !== undefined ? fmtAge(age) : "—"} · normalized to 18 dec
              </p>
            </div>
            <SessionChip />
          </CardHeader>
          <CardContent className="pt-2">{now !== undefined && <RoundsChart points={points} now={now} />}</CardContent>
        </Card>

        <div className="grid min-w-0 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>US cash session</CardTitle>
            </CardHeader>
            <CardContent>
              <SessionChip large />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Official close</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <Stat label="Close mark" value={recorded ? fmtUsd18(close?.priceUsd) : "Not recorded"} unit={recorded ? `feed @ ${fmtNy(close?.updatedAt)}` : "USD · 18 dec"} />
              <Stat
                label="Session"
                value={last ? new Date(Number(last[1]) * 1000).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" }) : "—"}
                unit={last ? `16:00 close · id ${last[0].toString()}` : undefined}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-start justify-between pb-3">
            <div>
              <CardTitle>Vespers Vault</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">NVDA / USDG · cycle {cycleId?.toString() ?? "—"} {cycleActive ? "· active" : "· idle"}</p>
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
              <Stat label="Share price" value={fmtUsdg(sharePrice, 6)} unit="USDG per vspNVDA" />
              <Stat label="NVDA held" value={fmt18(inv?.[1], 4)} unit="raw NVDA · 18 dec" />
            </div>
            <SplitBar
              segments={[
                { label: "USDG", value: Number(inv?.[0] ?? 0n), display: `${fmtUsdg(inv?.[0])} USDG`, color: "s1" },
                { label: "NVDA", value: Number(inv?.[2] ?? 0n), display: `${fmtUsdg(inv?.[2])} USDG`, color: "s2" },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between pb-3">
            <div>
              <CardTitle>Amen Market</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">{count.toString()} market{count === 1n ? "" : "s"} · NVDA</p>
            </div>
            <Link href="/app/markets" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              Open <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-5">
            {m && mStatus ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[15px] font-medium leading-snug">
                    #{m.id.toString()} · Will NVDA gap at least {fmtBps(m.strikeBps)} from {fmtUsd18(m.closeMarkPrice)}?
                  </p>
                  <Badge variant={mStatus.v} className="shrink-0">
                    {mStatus.label}
                  </Badge>
                </div>
                <SplitBar
                  segments={[
                    { label: "YES pool", value: Number(m.yesPool), display: `${fmtUsdg(m.yesPool)} USDG`, color: "s1" },
                    { label: "NO pool", value: Number(m.noPool), display: `${fmtUsdg(m.noPool)} USDG`, color: "s2" },
                  ]}
                />
                <div className="grid grid-cols-2 gap-4">
                  <Stat label="Resolves at" value={fmtNyShort(m.resolveEarliestTs)} unit={`${fmtNyDay(m.resolveEarliestTs)} · first cash print at or after`} />
                  <Stat
                    label="Resolve print"
                    value={m.resolved || m.resolvePrice > 0n ? fmtUsd18(m.resolvePrice) : "—"}
                    unit={m.resolved ? `move ${fmtBps(m.moveBps)}` : "USD · 18 dec"}
                  />
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No markets yet.{isLocal && " The demo chain starts at Friday 16:02 New York. Run steps 1–2 of the demo below to create Market #1."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {isLocal && <DemoFlow />}
    </div>
  );
}
