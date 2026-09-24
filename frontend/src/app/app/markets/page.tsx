"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { parseUnits, maxUint256, zeroAddress, type Address } from "viem";
import { amenMarketAbi, amenOracleAbi, deployment, usdgAbi } from "@/lib/contracts";
import { activeChain, isLocal } from "@/lib/chains";
import { useBlockTs, useChainNow, useRoles, useSession, useStock, useTx } from "@/lib/hooks";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DetailRow, Stat } from "@/components/stat";
import { SplitBar } from "@/components/split-bar";
import { TxStatus } from "@/components/tx-status";
import { NoDeployment } from "@/components/no-deployment";
import { PageHeader } from "@/components/app/page-header";
import { bytes32ToString, fmtBps, fmtCountdown, fmtNy, fmtNyDay, fmtNyShort, fmtUsd18, fmtUsdg } from "@/lib/format";
import { cn } from "@/lib/utils";

type Market = {
  id: bigint;
  kind: number;
  stockToken: `0x${string}`;
  strikeBps: bigint;
  closeMarkPrice: bigint;
  closeMarkTs: bigint;
  startTs: bigint;
  endTs: bigint;
  resolveEarliestTs: bigint;
  yesPool: bigint;
  noPool: bigint;
  resolved: boolean;
  yesWins: boolean;
  voided: boolean;
  resolveReason: `0x${string}`;
  sessionId: bigint;
  maxNotional: bigint;
  takerFeeBps: bigint;
  resolvePrice: bigint;
  resolveMarkTs: bigint;
  resolveRoundId: bigint;
  moveBps: bigint;
};
type Position = { yes: bigint; no: bigint; claimed: boolean };

const RESOLVE_WINDOW = 3600;
const stripTz = (s: string) => s.replace(/,? (EDT|EST)$/, "");

function safeParse(v: string, dec: number): bigint {
  try {
    return v ? parseUnits(v, dec) : 0n;
  } catch {
    return 0n;
  }
}

export default function MarketsPage() {
  if (!deployment) return <NoDeployment />;
  return <Markets />;
}

function Markets() {
  const d = deployment!;
  const { stocks } = useSession();
  const [filter, setFilter] = useState<Address | "ALL">("ALL");
  const { data: count, isError } = useReadContract({ address: d.market, abi: amenMarketAbi, functionName: "marketCount", query: { refetchInterval: 4_000 } });
  const n = Number(count ?? 0n);
  const allIds = Array.from({ length: Math.min(n, 100) }, (_, i) => BigInt(n - i));
  const { data: heads } = useReadContracts({
    contracts: allIds.map((id) => ({ address: d.market, abi: amenMarketAbi, functionName: "getMarket" as const, args: [id] as const })),
    query: { enabled: allIds.length > 0, refetchInterval: 8_000 },
  });
  const stockOf = (i: number) => (heads?.[i]?.result as { stockToken: Address } | undefined)?.stockToken?.toLowerCase();
  const ids = filter === "ALL" ? allIds : allIds.filter((_, i) => stockOf(i) === filter.toLowerCase());
  const countFor = (t: Address) => allIds.filter((_, i) => stockOf(i) === t.toLowerCase()).length;

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Amen Market" title="Say amen to the gap, or don't." />
      <p className="-mt-3 mb-2 max-w-3xl text-sm text-muted-foreground">
        Parimutuel YES/NO books in USDG, one per ticker per session. A winner gets stake × (total pool − 1% fee) ÷ winning
        pool. Settlement uses the ticker&apos;s first Chainlink print during the cash session at or after the resolve time. If
        none arrives within 60 minutes, or that ticker&apos;s oracle is frozen, the market voids and every stake is refunded 1:1.
      </p>

      <CloseTable />

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by ticker">
        {[{ token: "ALL" as const, symbol: "All tickers", n: allIds.length }, ...stocks.map((st) => ({ token: st.token, symbol: st.symbol, n: countFor(st.token) }))].map((c) => (
          <button
            key={c.token}
            role="tab"
            aria-selected={filter === c.token}
            onClick={() => setFilter(c.token)}
            className={cn(
              "inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-sm transition-colors",
              filter === c.token ? "border-primary/50 bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {c.symbol}
            <span className="font-mono text-[11px] opacity-70">{c.n}</span>
          </button>
        ))}
      </div>

      {isError && count === undefined ? (
        <Card className="p-6 text-sm text-destructive">
          Can&apos;t reach the Amen chain at <code className="font-mono">{activeChain.rpcUrls.default.http[0]}</code>, so markets can&apos;t be loaded.
        </Card>
      ) : ids.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          No markets {filter === "ALL" ? "yet" : "for this ticker yet"}.
          {!isLocal && " New gap markets open after Friday's 16:00 New York close, once the official close is recorded."}
          {isLocal && filter === "ALL" && (
            <>
              {" "}
              The demo chain starts at Friday 16:02 New York. Run steps 1–2 on the{" "}
              <Link href="/app" className="text-foreground underline underline-offset-2">
                overview
              </Link>{" "}
              and the NVDA market will appear here.
            </>
          )}
        </Card>
      ) : (
        ids.map((id) => <MarketCard key={id.toString()} id={id} />)
      )}
    </div>
  );
}

/** Per-ticker official closes: anyone can record one after the bell; keepers can open the gap market. */
function CloseTable() {
  const d = deployment!;
  const ts = useBlockTs();
  const session = useSession();
  const roles = useRoles(d.market, amenMarketAbi);
  const tx = useTx();
  const [strike, setStrike] = useState("100");
  const [cap, setCap] = useState("2000");
  const stocks = session.stocks.filter((s) => s.allowed);

  const { data: last } = useReadContract({
    address: d.oracle,
    abi: amenOracleAbi,
    functionName: "lastCloseAt",
    args: ts ? [ts] : undefined,
    query: { enabled: !!ts },
  });
  const sessionId = last?.[0];
  const { data: reads } = useReadContracts({
    contracts:
      sessionId !== undefined
        ? stocks.flatMap((s) => [
            { address: d.oracle, abi: amenOracleAbi, functionName: "hasOfficialClose" as const, args: [s.token, sessionId] as const },
            { address: d.oracle, abi: amenOracleAbi, functionName: "officialClose" as const, args: [s.token, sessionId] as const },
          ])
        : [],
    query: { enabled: sessionId !== undefined && stocks.length > 0, refetchInterval: 4_000 },
  });

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <p className="text-[15px] font-medium">Official closes</p>
          <p className="text-xs text-muted-foreground">
            Last session: {last ? stripTz(fmtNy(last[1])) : "—"} · the last Chainlink round at or before the bell, within 30 minutes.
            Anyone can record it.
          </p>
        </div>
        {roles.canOperate && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            New markets: strike
            <Input className="h-8 w-16" value={strike} onChange={(e) => setStrike(e.target.value)} aria-label="strike bps" />
            bps · cap
            <Input className="h-8 w-24" value={cap} onChange={(e) => setCap(e.target.value)} aria-label="max notional USDG" />
            USDG
          </div>
        )}
      </div>
      <div className="divide-y divide-border">
        {stocks.map((st, i) => {
          const recorded = reads?.[i * 2]?.result as boolean | undefined;
          const close = reads?.[i * 2 + 1]?.result as { priceUsd: bigint; updatedAt: bigint } | undefined;
          return (
            <div key={st.token} className="grid grid-cols-[4rem_1fr_auto] items-center gap-3 px-5 py-2.5 sm:grid-cols-[4rem_8rem_1fr_auto]">
              <span className="text-sm font-semibold">{st.symbol}</span>
              <span className="hidden font-mono text-xs text-muted-foreground sm:block">mark {fmtUsd18(st.mark?.priceUsd)}</span>
              <span className="font-mono text-xs">
                {recorded ? (
                  <>
                    close <span className="text-foreground">{fmtUsd18(close?.priceUsd)}</span>
                    <span className="text-muted-foreground"> · feed {fmtNyShort(close?.updatedAt)}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">close not recorded</span>
                )}
              </span>
              <span className="flex justify-end gap-2">
                {!recorded && !session.cashOpen && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={tx.busy}
                    onClick={() => tx.send(`Record ${st.symbol} close`, { address: d.oracle, abi: amenOracleAbi, functionName: "recordSessionClose", args: [st.token] })}
                  >
                    Record close
                  </Button>
                )}
                {roles.canOperate && recorded && sessionId !== undefined && (
                  <Button
                    size="sm"
                    disabled={tx.busy}
                    onClick={() =>
                      tx.send(`Create ${st.symbol} gap market`, {
                        address: d.market,
                        abi: amenMarketAbi,
                        functionName: "createGapMarket",
                        args: [st.token, sessionId, BigInt(strike || "0"), 0n, safeParse(cap, 6)],
                      })
                    }
                  >
                    Create market
                  </Button>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {tx.state.status !== "idle" && (
        <div className="px-5 pb-5">
          <TxStatus state={tx.state} />
        </div>
      )}
    </Card>
  );
}

function MarketCard({ id }: { id: bigint }) {
  const d = deployment!;
  const { address } = useAccount();
  const now = useChainNow();
  const tx = useTx();
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [amt, setAmt] = useState("100");
  const me = address ?? zeroAddress;
  const amount = safeParse(amt, 6);
  const { data } = useReadContracts({
    contracts: [
      { address: d.market, abi: amenMarketAbi, functionName: "getMarket", args: [id] },
      { address: d.market, abi: amenMarketAbi, functionName: "positionOf", args: [id, me] },
      { address: d.market, abi: amenMarketAbi, functionName: "claimable", args: [id, me] },
      { address: d.usdg, abi: usdgAbi, functionName: "allowance", args: [me, d.market] },
      { address: d.market, abi: amenMarketAbi, functionName: "quote", args: [id, side === "yes", amount] },
    ],
    query: { refetchInterval: 4_000 },
  });
  const m = data?.[0]?.result as Market | undefined;
  const pos = data?.[1]?.result as Position | undefined;
  const claimable = data?.[2]?.result as bigint | undefined;
  const allowance = (data?.[3]?.result as bigint | undefined) ?? 0n;
  const quote = data?.[4]?.result as bigint | undefined;
  const stock = useStock(m?.stockToken);
  const sym = stock?.symbol ?? "…";
  if (!m) return null;

  const total = m.yesPool + m.noPool;
  const t = now ?? 0;
  const trading = !m.resolved && !m.voided && t >= Number(m.startTs) && t < Number(m.endTs);
  const resolvable = !m.resolved && !m.voided && t >= Number(m.resolveEarliestTs) && t <= Number(m.resolveEarliestTs) + RESOLVE_WINDOW;
  const voidable = !m.resolved && !m.voided && t > Number(m.resolveEarliestTs) + RESOLVE_WINDOW;
  const status = m.voided
    ? { label: `Voided · ${bytes32ToString(m.resolveReason)}`, v: "frozen" as const }
    : m.resolved
      ? { label: `Resolved · ${m.yesWins ? "YES" : "NO"}`, v: "brand" as const }
      : trading
        ? { label: "Trading", v: "cash" as const }
        : { label: "Awaiting resolve", v: "vespers" as const };
  const mult = (pool: bigint) => (pool > 0n ? (Number(total) * (1 - Number(m.takerFeeBps) / 10000)) / Number(pool) : undefined);

  const buy = async () => {
    if (allowance < amount) {
      const ok = await tx.send("Approve USDG", { address: d.usdg, abi: usdgAbi, functionName: "approve", args: [d.market, maxUint256] });
      if (!ok) return;
    }
    await tx.send(`Buy ${side.toUpperCase()}`, { address: d.market, abi: amenMarketAbi, functionName: "buy", args: [id, side === "yes", amount] });
  };

  return (
    <Card className="overflow-hidden">
      <div className="grid lg:grid-cols-[1fr_340px]">
        <div className="space-y-5 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5">
              <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                <span className="text-foreground">{sym}</span> · #{id.toString()} · {m.kind === 0 ? "Gap close → open" : "Absolute move"}
              </p>
              <h3 className="text-lg font-medium leading-snug">
                Will {sym} {m.kind === 0 ? "gap" : "move"} at least {fmtBps(m.strikeBps)} either way from {fmtUsd18(m.closeMarkPrice)}?
              </h3>
              <p className="text-[13px] text-muted-foreground">
                YES if |first cash print at or after {fmtNy(m.resolveEarliestTs)} ÷ reference − 1| ≥ {fmtBps(m.strikeBps)}.
              </p>
            </div>
            <Badge variant={status.v} className="shrink-0">
              {status.label}
            </Badge>
          </div>

          <SplitBar
            segments={[
              { label: "YES pool", value: Number(m.yesPool), display: `${fmtUsdg(m.yesPool)} USDG · ${mult(m.yesPool)?.toFixed(3) ?? "—"}×`, color: "s1" },
              { label: "NO pool", value: Number(m.noPool), display: `${fmtUsdg(m.noPool)} USDG · ${mult(m.noPool)?.toFixed(3) ?? "—"}×`, color: "s2" },
            ]}
          />

          <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
            <Stat label="Reference" value={fmtUsd18(m.closeMarkPrice)} unit={`official close · feed ${fmtNyShort(m.closeMarkTs)}`} />
            <Stat
              label={trading ? "Trading ends in" : "Resolves at"}
              value={trading ? fmtCountdown(Number(m.endTs) - t) : fmtNyShort(m.resolveEarliestTs)}
              unit={trading ? `${fmtNyDay(m.endTs)} · ${fmtNyShort(m.endTs)} New York` : `${fmtNyDay(m.resolveEarliestTs)} · void if unresolved +60 min`}
            />
            <Stat label="Cap" value={fmtUsdg(m.maxNotional, 0)} unit="USDG max notional" />
            {m.resolved || (m.voided && m.resolvePrice > 0n) ? (
              <Stat label="Resolve print" value={fmtUsd18(m.resolvePrice)} unit={`move ${fmtBps(m.moveBps)} · round ${m.resolveRoundId}`} />
            ) : (
              <Stat label="Taker fee" value={fmtBps(m.takerFeeBps)} unit="only if it resolves" />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4 text-sm">
            <span className="text-muted-foreground">
              Your position: <span className="font-mono text-foreground">{fmtUsdg(pos?.yes)}</span> YES ·{" "}
              <span className="font-mono text-foreground">{fmtUsdg(pos?.no)}</span> NO (USDG)
              {pos?.claimed && " · claimed"}
            </span>
            <div className="ml-auto flex gap-2">
              {resolvable && (
                <Button size="sm" variant="outline" disabled={tx.busy} onClick={() => tx.send("Resolve", { address: d.market, abi: amenMarketAbi, functionName: "resolve", args: [id] })}>
                  Resolve
                </Button>
              )}
              {voidable && (
                <Button size="sm" variant="outline" disabled={tx.busy} onClick={() => tx.send("Void", { address: d.market, abi: amenMarketAbi, functionName: "voidMarket", args: [id] })}>
                  Void (refund all)
                </Button>
              )}
              {!!claimable && claimable > 0n && (
                <Button size="sm" disabled={tx.busy} onClick={() => tx.send("Claim", { address: d.market, abi: amenMarketAbi, functionName: "claim", args: [id] })}>
                  Claim {fmtUsdg(claimable)} USDG
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4 border-t border-border bg-card-raised/40 p-5 sm:p-6 lg:border-l lg:border-t-0">
          {trading ? (
            <>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-card-raised p-1">
                {(["yes", "no"] as const).map((sd) => (
                  <button
                    key={sd}
                    onClick={() => setSide(sd)}
                    className={cn(
                      "h-8 rounded-md text-sm font-medium uppercase tracking-wide text-muted-foreground transition-colors",
                      side === sd && (sd === "yes" ? "bg-s1 text-white" : "bg-s2 text-white"),
                    )}
                  >
                    {sd}
                  </button>
                ))}
              </div>
              <div className="relative">
                <Input value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" aria-label="USDG stake" className="h-12 pr-20 text-base" />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-border bg-card px-2 py-1 font-mono text-xs">USDG</span>
              </div>
              <div className="divide-y divide-border rounded-lg border border-border px-3">
                <DetailRow k={`Payout if ${side.toUpperCase()} wins`} v={`${fmtUsdg(quote)} USDG`} />
                <DetailRow k="Multiple" v={quote && amount > 0n ? `${(Number(quote) / Number(amount)).toFixed(3)}×` : "—"} />
                <DetailRow k="Max loss" v={`${fmtUsdg(amount)} USDG`} />
              </div>
              <Button size="lg" variant={side} className="w-full" disabled={!address || tx.busy || amount === 0n} onClick={buy}>
                {!address ? "Connect a wallet to trade" : `Buy ${side.toUpperCase()}`}
              </Button>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Payout is an estimate: it changes as others trade, until trading ends. Paid in USDG (6 decimals).
              </p>
            </>
          ) : (
            <div className="flex h-full flex-col justify-center gap-2 py-6 text-center">
              <p className="text-sm font-medium">{m.resolved || m.voided ? "Settled" : "Trading closed"}</p>
              <p className="text-[13px] text-muted-foreground">
                {m.voided
                  ? "Every stake is refunded 1:1, with no fee."
                  : m.resolved
                    ? `${m.yesWins ? "YES" : "NO"} won on the first cash print (${fmtUsd18(m.resolvePrice)}, move ${fmtBps(m.moveBps)}).`
                    : `Resolves on the first cash-session print at or after ${stripTz(fmtNy(m.resolveEarliestTs))} New York.`}
              </p>
            </div>
          )}
          <TxStatus state={tx.state} className="mt-0" />
        </div>
      </div>
    </Card>
  );
}
