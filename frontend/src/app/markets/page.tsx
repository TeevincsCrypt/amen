"use client";

import { useState } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { parseUnits, maxUint256, zeroAddress } from "viem";
import { amenMarketAbi, amenOracleAbi, deployment, usdgAbi } from "@/lib/contracts";
import { useBlockTs, useChainNow, useRoles, useSession, useTx } from "@/lib/hooks";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Stat } from "@/components/stat";
import { TxStatus } from "@/components/tx-status";
import { NoDeployment } from "@/components/no-deployment";
import { DemoControls } from "@/components/demo-controls";
import { bytes32ToString, fmtBps, fmtCountdown, fmtNy, fmtUsd18, fmtUsdg } from "@/lib/format";

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

export default function MarketsPage() {
  if (!deployment) return <NoDeployment />;
  return <Markets />;
}

function Markets() {
  const d = deployment!;
  const { data: count } = useReadContract({ address: d.market, abi: amenMarketAbi, functionName: "marketCount", query: { refetchInterval: 4_000 } });
  const ids = count ? Array.from({ length: Number(count) }, (_, i) => BigInt(Number(count) - i)) : [];

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.3em] text-cash">Amen Market · NVDA</p>
        <h1 className="font-serif text-4xl">Say amen to the gap, or don&apos;t.</h1>
        <p className="max-w-2xl text-muted-foreground">
          These are parimutuel YES/NO books in USDG. A winner gets their stake × (total pool − 1% fee) ÷ winning pool.
          Settlement uses the first Chainlink print during the cash session at or after the resolve time. If none arrives
          within 60 minutes, or the oracle is frozen, the market voids and every stake is refunded 1:1.
        </p>
      </header>

      <SessionAdmin />

      {ids.length === 0 ? (
        <p className="text-sm text-muted-foreground">No markets yet.</p>
      ) : (
        <div className="grid gap-6">
          {ids.map((id) => (
            <MarketCard key={id.toString()} id={id} />
          ))}
        </div>
      )}

      <DemoControls />
    </div>
  );
}

/** Record the official close (permissionless) and, for keepers, create the weekend gap market. */
function SessionAdmin() {
  const d = deployment!;
  const ts = useBlockTs();
  const session = useSession();
  const roles = useRoles(d.market, amenMarketAbi);
  const tx = useTx();
  const [strike, setStrike] = useState("100");
  const [cap, setCap] = useState("10000");

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
        ? [
            { address: d.oracle, abi: amenOracleAbi, functionName: "hasOfficialClose", args: [d.nvda, sessionId] },
            { address: d.oracle, abi: amenOracleAbi, functionName: "officialClose", args: [d.nvda, sessionId] },
          ]
        : [],
    query: { enabled: sessionId !== undefined, refetchInterval: 4_000 },
  });
  const recorded = reads?.[0]?.result as boolean | undefined;
  const close = reads?.[1]?.result as { priceUsd: bigint; updatedAt: bigint } | undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Official close</CardTitle>
        <CardDescription>
          The reference for a gap market is the last Chainlink round at or before the 16:00 NY bell (within 30 minutes), recorded
          on-chain. Anyone can record it after the close.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Last session close" value={last ? fmtNy(last[1]) : "—"} unit={sessionId !== undefined ? `session ${sessionId}` : undefined} />
          <Stat label="Official close" value={recorded ? fmtUsd18(close?.priceUsd) : "not recorded"} unit={recorded ? `feed @ ${fmtNy(close?.updatedAt)}` : "USD · 18 dec"} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!recorded && !session.cashOpen && (
            <Button size="sm" variant="outline" disabled={tx.busy} onClick={() => tx.send("Record close", { address: d.oracle, abi: amenOracleAbi, functionName: "recordSessionClose", args: [d.nvda] })}>
              Record official close
            </Button>
          )}
          {roles.canOperate && recorded && sessionId !== undefined && (
            <>
              <span className="text-xs text-muted-foreground">New NVDA gap market: strike</span>
              <Input className="w-20" value={strike} onChange={(e) => setStrike(e.target.value)} aria-label="strike bps" />
              <span className="text-xs text-muted-foreground">bps · cap</span>
              <Input className="w-28" value={cap} onChange={(e) => setCap(e.target.value)} aria-label="max notional USDG" />
              <span className="text-xs text-muted-foreground">USDG</span>
              <Button
                size="sm"
                disabled={tx.busy}
                onClick={() =>
                  tx.send("Create gap market", {
                    address: d.market,
                    abi: amenMarketAbi,
                    functionName: "createGapMarket",
                    args: [d.nvda, sessionId, BigInt(strike || "0"), 0n, parseUnits(cap || "0", 6)],
                  })
                }
              >
                Create
              </Button>
            </>
          )}
        </div>
        <TxStatus state={tx.state} />
      </CardContent>
    </Card>
  );
}

function MarketCard({ id }: { id: bigint }) {
  const d = deployment!;
  const { address } = useAccount();
  const now = useChainNow();
  const tx = useTx();
  const [amt, setAmt] = useState("100");
  const me = address ?? zeroAddress;
  const { data } = useReadContracts({
    contracts: [
      { address: d.market, abi: amenMarketAbi, functionName: "getMarket", args: [id] },
      { address: d.market, abi: amenMarketAbi, functionName: "positionOf", args: [id, me] },
      { address: d.market, abi: amenMarketAbi, functionName: "claimable", args: [id, me] },
      { address: d.usdg, abi: usdgAbi, functionName: "allowance", args: [me, d.market] },
    ],
    query: { refetchInterval: 4_000 },
  });
  const m = data?.[0]?.result as Market | undefined;
  const pos = data?.[1]?.result as Position | undefined;
  const claimable = data?.[2]?.result as bigint | undefined;
  const allowance = data?.[3]?.result as bigint | undefined;
  if (!m) return null;

  const total = m.yesPool + m.noPool;
  const t = now ?? 0;
  const trading = !m.resolved && !m.voided && t >= Number(m.startTs) && t < Number(m.endTs);
  const resolvable = !m.resolved && !m.voided && t >= Number(m.resolveEarliestTs) && t <= Number(m.resolveEarliestTs) + RESOLVE_WINDOW;
  const voidable = !m.resolved && !m.voided && t > Number(m.resolveEarliestTs) + RESOLVE_WINDOW;
  const status = m.voided
    ? { label: `Voided · ${bytes32ToString(m.resolveReason)}`, v: "frozen" as const }
    : m.resolved
      ? { label: `Resolved · ${m.yesWins ? "YES" : "NO"}`, v: "gilt" as const }
      : trading
        ? { label: "Trading", v: "cash" as const }
        : { label: "Awaiting resolve", v: "vespers" as const };
  const mult = (side: bigint) => (side > 0n ? (Number(total) * (1 - Number(m.takerFeeBps) / 10000)) / Number(side) : undefined);

  const buy = async (yes: boolean) => {
    const a = parseUnits(amt || "0", 6);
    if ((allowance ?? 0n) < a) {
      const ok = await tx.send("Approve USDG", { address: d.usdg, abi: usdgAbi, functionName: "approve", args: [d.market, maxUint256] });
      if (!ok) return;
    }
    await tx.send(`Buy ${yes ? "YES" : "NO"}`, { address: d.market, abi: amenMarketAbi, functionName: "buy", args: [id, yes, a] });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            #{id.toString()} · {m.kind === 0 ? "Gap close → open" : "Absolute move"}
          </p>
          <CardTitle>
            Will NVDA {m.kind === 0 ? "gap" : "move"} at least {fmtBps(m.strikeBps)} either way from {fmtUsd18(m.closeMarkPrice)}?
          </CardTitle>
          <CardDescription>
            YES if |first cash print at or after {fmtNy(m.resolveEarliestTs)} ÷ reference − 1| ≥ {fmtBps(m.strikeBps)}. Reference: official close,
            feed round at {fmtNy(m.closeMarkTs)}.
          </CardDescription>
        </div>
        <Badge variant={status.v}>{status.label}</Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Stat label="YES pool" value={fmtUsdg(m.yesPool)} unit={`USDG · pays ${mult(m.yesPool)?.toFixed(3) ?? "—"}×`} />
          <Stat label="NO pool" value={fmtUsdg(m.noPool)} unit={`USDG · pays ${mult(m.noPool)?.toFixed(3) ?? "—"}×`} />
          <Stat label="Cap" value={fmtUsdg(m.maxNotional, 0)} unit="USDG max notional" />
          <Stat
            label={trading ? "Trading ends" : "Resolve at"}
            value={trading ? fmtCountdown(Number(m.endTs) - t) : fmtNy(m.resolveEarliestTs)}
            unit={trading ? fmtNy(m.endTs) : "void if unresolved +60 min"}
          />
          {(m.resolved || (m.voided && m.resolvePrice > 0n)) && (
            <Stat label="Resolve print" value={fmtUsd18(m.resolvePrice)} unit={`move ${fmtBps(m.moveBps)} · round ${m.resolveRoundId}`} />
          )}
        </div>

        {trading && (
          <div className="flex flex-wrap items-center gap-2">
            <Input className="w-32" value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" aria-label="USDG stake" />
            <span className="text-xs text-muted-foreground">USDG</span>
            <Button variant="yes" disabled={!address || tx.busy} onClick={() => buy(true)}>
              Buy YES
            </Button>
            <Button variant="no" disabled={!address || tx.busy} onClick={() => buy(false)}>
              Buy NO
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4 text-sm">
          <span className="text-muted-foreground">
            Your position: <span className="font-mono text-cash">{fmtUsdg(pos?.yes)}</span> YES ·{" "}
            <span className="font-mono text-vespers">{fmtUsdg(pos?.no)}</span> NO (USDG)
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
        <TxStatus state={tx.state} />
      </CardContent>
    </Card>
  );
}
