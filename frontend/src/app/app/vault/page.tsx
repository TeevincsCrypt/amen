"use client";

import { useState } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { formatUnits, maxUint256, parseUnits, zeroAddress, type Address } from "viem";
import { Lock, Wrench } from "lucide-react";
import { deployment, usdgAbi, vespersVaultAbi } from "@/lib/contracts";
import { useRoles, useSession, useStock, useTx } from "@/lib/hooks";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DetailRow, Figure, Stat } from "@/components/stat";
import { SplitBar } from "@/components/split-bar";
import { TxStatus } from "@/components/tx-status";
import { WalletHoldings } from "@/components/wallet-holdings";
import { NoDeployment } from "@/components/no-deployment";
import { PageHeader } from "@/components/app/page-header";
import { fmt18, fmtBps, fmtNy, fmtUsd18, fmtUsdg } from "@/lib/format";
import { cn } from "@/lib/utils";

type Cycle = { id: bigint; startTs: bigint; endTs: bigint; navStart: bigint; navEnd: bigint; realizedPnl: bigint; perfFee: bigint };

export default function VaultPage() {
  if (!deployment) return <NoDeployment />;
  return <Vault />;
}

function safeParse(v: string, dec: number): bigint {
  try {
    return v ? parseUnits(v, dec) : 0n;
  } catch {
    return 0n;
  }
}

function Vault() {
  const d = deployment!;
  const { address } = useAccount();
  const me = address ?? zeroAddress;
  const session = useSession();
  const roles = useRoles(d.vault, vespersVaultAbi);
  const tx = useTx();
  const keeperTx = useTx();
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amt, setAmt] = useState("100");
  const [buyAmt, setBuyAmt] = useState("40");

  const V = { address: d.vault, abi: vespersVaultAbi } as const;
  const { data } = useReadContracts({
    contracts: [
      { ...V, functionName: "inventory" },
      { ...V, functionName: "totalSupply" },
      { ...V, functionName: "convertToAssets", args: [10n ** 18n] },
      { ...V, functionName: "currentCycleId" },
      { ...V, functionName: "cycleActive" },
      { ...V, functionName: "cycleNetFlows" },
      { ...V, functionName: "maxInventoryBps" },
      { ...V, functionName: "perfFeeBps" },
      { ...V, functionName: "accruedFees" },
      { ...V, functionName: "balanceOf", args: [me] },
      { address: d.usdg, abi: usdgAbi, functionName: "allowance", args: [me, d.vault] },
      { address: d.usdg, abi: usdgAbi, functionName: "balanceOf", args: [me] },
      { ...V, functionName: "maxDeviationBps" },
      { ...V, functionName: "depositCap" },
      { ...V, functionName: "maxDeposit", args: [me] },
      { ...V, functionName: "stock" },
      { ...V, functionName: "symbol" },
      { ...V, functionName: "swapAdapter" },
    ],
    query: { refetchInterval: 4_000 },
  });
  const r = <X,>(i: number) => data?.[i]?.result as X | undefined;
  const inv = r<readonly [bigint, bigint, bigint, bigint, bigint, boolean, `0x${string}`]>(0);
  const [usdgFree, stockRaw, stockValue, nav] = inv ?? [];
  const supply = r<bigint>(1);
  const sharePrice = r<bigint>(2);
  const cycleId = r<bigint>(3) ?? 0n;
  const cycleActive = r<boolean>(4);
  const netFlows = r<bigint>(5);
  const maxInvBps = r<bigint>(6);
  const perfFeeBps = r<bigint>(7);
  const fees = r<bigint>(8);
  const myShares = r<bigint>(9) ?? 0n;
  const allowance = r<bigint>(10) ?? 0n;
  const walletUsdg = r<bigint>(11);
  const maxDevBps = r<bigint>(12);
  const depositCap = r<bigint>(13);
  const capRoom = r<bigint>(14);
  const vaultStock = useStock(r<Address>(15));
  const sym = vaultStock?.symbol ?? "…";
  const shareSym = r<string>(16) ?? "shares";
  const stockMark = vaultStock?.mark;
  const capped = depositCap !== undefined && depositCap < 2n ** 255n;
  const adapter = r<Address>(17);
  const trading = !!adapter && adapter !== zeroAddress;


  const amount = safeParse(amt, 6);
  const overCap = tab === "deposit" && capped && capRoom !== undefined && amount > capRoom;
  const { data: extra } = useReadContracts({
    contracts: [
      { ...V, functionName: "convertToAssets", args: [myShares] },
      { ...V, functionName: "previewDeposit", args: [amount] },
      { ...V, functionName: "previewWithdraw", args: [amount] },
    ],
    query: { refetchInterval: 4_000 },
  });
  const myValue = extra?.[0]?.result as bigint | undefined;
  const previewShares = (tab === "deposit" ? extra?.[1]?.result : extra?.[2]?.result) as bigint | undefined;
  const { data: cycleData } = useReadContract({ ...V, functionName: "cycles", args: [cycleId], query: { enabled: cycleId > 0n, refetchInterval: 4_000 } });
  const current = cycleId > 0n ? (cycleData as Cycle | undefined) : undefined;

  const holdsStock = (stockRaw ?? 0n) > 0n;
  const vespersLock = holdsStock && !session.cashOpen;
  // A freeze of this vault's own stock (or a protocol-wide freeze) locks NAV-based entry and exit.
  const stockFrozen = session.manualFreeze || !!stockMark?.frozen;
  const frozenReason = session.manualFreeze ? "MANUAL" : (stockMark?.freezeReason ?? "");
  const frozenLock = stockFrozen && (holdsStock || session.cashOpen);
  const needsFlatten = tab === "withdraw" && usdgFree !== undefined && amount > usdgFree;
  const lockReason = frozenLock
    ? `${sym} oracle frozen (${frozenReason}). Deposits and withdrawals are locked until the mark is healthy.`
    : vespersLock
      ? `The vault is carrying ${sym} through Vespers. Its weekend mark may be stale, so entry and exit reopen after the next flatten.`
      : undefined;

  const submit = async () => {
    if (tab === "deposit") {
      if (allowance < amount) {
        const ok = await tx.send("Approve USDG", { address: d.usdg, abi: usdgAbi, functionName: "approve", args: [d.vault, maxUint256] });
        if (!ok) return;
      }
      await tx.send("Deposit", { ...V, functionName: "deposit", args: [amount, address!] });
    } else if (!amt) {
      await tx.send("Redeem all", { ...V, functionName: "redeem", args: [myShares, address!, address!] });
    } else {
      await tx.send("Withdraw", { ...V, functionName: "withdraw", args: [amount, address!, address!] });
    }
  };

  const pnl = current && !cycleActive ? current.realizedPnl : undefined;

  return (
    <div className="space-y-4">
      <PageHeader eyebrow={`Vespers Vault · ${sym} / USDG`} title="Inventory for the hours the market sleeps.">
        <Badge variant={lockReason ? "frozen" : "cash"}>
          {lockReason ? <Lock className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
          {lockReason ? "Entry / exit locked" : "Entry / exit open"}
        </Badge>
      </PageHeader>

      {lockReason && (
        <div className="flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/[0.06] px-4 py-3 text-sm text-foreground/90">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          {lockReason}
        </div>
      )}

      <Card className="grid grid-cols-2 divide-border lg:grid-cols-4 lg:divide-x">
        <div className="p-5">
          <p className="text-xs text-muted-foreground">Net asset value</p>
          <Figure text={fmtUsdg(nav)} className="mt-1 block text-3xl" />
          <p className="font-mono text-[10.5px] text-muted-foreground">USDG · 6 dec</p>
        </div>
        <Stat className="p-5" label="Share price" value={fmtUsdg(sharePrice, 6)} unit={`USDG per 1 ${shareSym}`} />
        <Stat
          className="p-5"
          label={capped ? "Beta deposit cap" : "Shares outstanding"}
          value={capped ? `${fmtUsdg(nav, 0)} / ${fmtUsdg(depositCap, 0)}` : fmt18(supply, 2)}
          unit={capped ? "USDG NAV used / cap" : `${shareSym} · 18 dec`}
        />
        <Stat className="p-5" label={`${sym} mark`} value={fmtUsd18(stockMark?.priceUsd)} unit={stockMark?.frozen ? `frozen · ${stockMark.freezeReason}` : "USD · Chainlink → 18 dec"} />
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Inventory</CardTitle>
                <CardDescription>
                  {trading
                    ? `${sym} only while cash is closed, up to ${fmtBps(maxInvBps)} of NAV. Swaps within ${fmtBps(maxDevBps)} of the mark.`
                    : `Trading is off: the vault holds USDG only. When it's turned on, it carries ${sym} while cash is closed.`}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 pt-4">
                <SplitBar
                  marker={maxInvBps !== undefined ? { at: 100 - Number(maxInvBps) / 100, label: `${fmtBps(maxInvBps)} cap` } : undefined}
                  segments={[
                    { label: "USDG", value: Number(usdgFree ?? 0n), display: `${fmtUsdg(usdgFree)} USDG`, color: "s1" },
                    { label: sym, value: Number(stockValue ?? 0n), display: `${fmtUsdg(stockValue)} USDG`, color: "s2" },
                  ]}
                />
                <div className="divide-y divide-border">
                  <DetailRow
                    k="Trading"
                    v={
                      adapter === undefined ? "—" : trading ? (
                        <span className="text-up">On · buys only below the mark</span>
                      ) : (
                        <span className="text-muted-foreground">Off · no swap venue set</span>
                      )
                    }
                  />
                  <DetailRow k="USDG free" v={`${fmtUsdg(usdgFree)} USDG`} />
                  <DetailRow k={`${sym} held`} v={`${fmt18(stockRaw, 6)} raw`} />
                  <DetailRow k={`${sym} value`} v={`${fmtUsdg(stockValue)} USDG`} />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Cycle {cycleId > 0n ? `#${cycleId}` : ""}</CardTitle>
                <CardDescription>A cycle runs from the close to the next open. PnL is realized at the flatten.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-xs text-muted-foreground">{cycleActive ? "Status" : "Realized PnL"}</p>
                  {cycleActive ? (
                    <p className="mt-1 text-3xl font-semibold tracking-tight text-primary">Active</p>
                  ) : pnl !== undefined ? (
                    <p className={cn("mt-1 text-3xl font-semibold tracking-tight", pnl > 0n ? "text-up" : pnl < 0n ? "text-destructive" : "")}>
                      {pnl >= 0n ? "+" : "−"}
                      {fmtUsdg(pnl < 0n ? -pnl : pnl, 6)}
                    </p>
                  ) : (
                    <p className="mt-1 text-3xl font-semibold tracking-tight text-muted-foreground">—</p>
                  )}
                  <p className="font-mono text-[10.5px] text-muted-foreground">USDG · 6 dec · before {fmtBps(perfFeeBps)} perf fee</p>
                </div>
                <div className="divide-y divide-border">
                  <DetailRow k="NAV start" v={current ? `${fmtUsdg(current.navStart)} USDG` : "—"} />
                  <DetailRow k={cycleActive ? "Net LP flows" : "NAV end"} v={current ? `${fmtUsdg(cycleActive ? netFlows : current.navEnd, cycleActive ? 2 : 6)} USDG` : "—"} />
                  <DetailRow k="Perf fee" v={current && !cycleActive ? `${fmtUsdg(current.perfFee, 6)} USDG` : "—"} />
                  <DetailRow k="Started" v={current ? fmtNy(current.startTs) : "—"} />
                </div>
              </CardContent>
            </Card>
          </div>

          <CycleHistory latest={cycleId} active={!!cycleActive} />

          <WalletHoldings />

          {roles.canOperate && (
            <Card className="border-primary/20">
              <CardHeader className="flex-row items-start gap-3">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                  <Wrench className="h-4 w-4 text-primary" />
                </span>
                <div>
                  <CardTitle>Keeper console</CardTitle>
                  <CardDescription>Accrued fees: {fmtUsdg(fees, 6)} USDG. Inventory can only be added during Vespers.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" disabled={keeperTx.busy} onClick={() => keeperTx.send("Start cycle", { ...V, functionName: "startCycle" })}>
                    Start cycle
                  </Button>
                  <div className="flex items-center gap-2">
                    <Input className="h-8 w-24" value={buyAmt} onChange={(e) => setBuyAmt(e.target.value)} aria-label="USDG to spend" />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={keeperTx.busy}
                      onClick={() => keeperTx.send(`Buy ${sym} inventory`, { ...V, functionName: "buyInventory", args: [safeParse(buyAmt, 6), 0n] })}
                    >
                      Buy {sym} (USDG)
                    </Button>
                  </div>
                  <Button size="sm" variant="outline" disabled={keeperTx.busy} onClick={() => keeperTx.send("Flatten", { ...V, functionName: "flatten", args: [0n] })}>
                    Flatten
                  </Button>
                  <Button size="sm" variant="outline" disabled={keeperTx.busy} onClick={() => keeperTx.send("End cycle", { ...V, functionName: "endCycle" })}>
                    End cycle
                  </Button>
                  <Button size="sm" variant="ghost" disabled={keeperTx.busy || !fees} onClick={() => keeperTx.send("Claim fees", { ...V, functionName: "claimFees" })}>
                    Claim fees
                  </Button>
                </div>
                <TxStatus state={keeperTx.state} />
              </CardContent>
            </Card>
          )}
        </div>

        <Card className="h-fit xl:sticky xl:top-20">
          <CardHeader className="pb-4">
            <CardTitle>Vault exchange</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-card-raised p-1">
              {(["deposit", "withdraw"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setTab(t);
                    setAmt(t === "deposit" ? "100" : "");
                  }}
                  className={cn("h-8 rounded-md text-sm capitalize text-muted-foreground transition-colors", tab === t && "bg-muted text-foreground")}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Amount</span>
                <span className="font-mono">
                  {tab === "deposit" ? `Wallet ${fmtUsdg(walletUsdg)} USDG` : `Position ≈ ${fmtUsdg(myValue)} USDG`}
                </span>
              </div>
              <div className="relative">
                <Input
                  value={amt}
                  onChange={(e) => setAmt(e.target.value)}
                  inputMode="decimal"
                  placeholder={tab === "withdraw" ? "blank = redeem all" : "0.00"}
                  aria-label="USDG amount"
                  className="h-12 pr-28 text-base"
                />
                <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
                  <button
                    className="rounded-md px-2 py-1 font-mono text-[10.5px] uppercase text-primary hover:bg-primary/10"
                    onClick={() =>
                      setAmt(
                        tab === "deposit"
                          ? walletUsdg !== undefined
                            ? formatUnits(walletUsdg, 6)
                            : ""
                          : "",
                      )
                    }
                  >
                    Max
                  </button>
                  <span className="rounded-md border border-border bg-card px-2 py-1 font-mono text-xs">USDG</span>
                </div>
              </div>
            </div>
            <div className="divide-y divide-border rounded-lg border border-border px-3">
              <DetailRow
                k={tab === "deposit" ? "You receive ≈" : "Shares burned ≈"}
                v={tab === "withdraw" && !amt ? `${fmt18(myShares, 4)} ${shareSym}` : `${fmt18(previewShares, 4)} ${shareSym}`}
              />
              <DetailRow k="Share price" v={`${fmtUsdg(sharePrice, 6)} USDG`} />
              {tab === "withdraw" && <DetailRow k="Free USDG in vault" v={`${fmtUsdg(usdgFree)} USDG`} />}
              {tab === "deposit" && capped && <DetailRow k="Beta cap room" v={`${fmtUsdg(capRoom)} of ${fmtUsdg(depositCap, 0)} USDG`} />}
              <DetailRow
                k="Status"
                v={
                  <span className={cn(lockReason || needsFlatten || overCap ? "text-destructive" : "text-up")}>
                    {lockReason ? "Locked" : needsFlatten ? "Needs flatten first" : overCap ? "Over the beta cap" : "Open"}
                  </span>
                }
              />
            </div>
            <Button size="lg" className="w-full" disabled={!address || tx.busy || (tab === "withdraw" && myShares === 0n)} onClick={submit}>
              {!address ? "Connect a wallet to continue" : tab === "deposit" ? "Deposit USDG" : amt ? "Withdraw USDG" : "Redeem all shares"}
            </Button>
            <TxStatus state={tx.state} className="mt-0" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Paid in USDG (6 decimals). Shares are {shareSym} (18 decimals). In-kind exits are disabled in Phase 1.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** The last eight finished cycles: what the vault earned (or lost) each weekend, before the perf fee. */
function CycleHistory({ latest, active }: { latest: bigint; active: boolean }) {
  const d = deployment!;
  const ids = Array.from({ length: Number(latest > 8n ? 8n : latest) }, (_, i) => latest - BigInt(i));
  const { data } = useReadContracts({
    contracts: ids.map((id) => ({ address: d.vault, abi: vespersVaultAbi, functionName: "cycles" as const, args: [id] as const })),
    query: { enabled: ids.length > 0, refetchInterval: 15_000 },
  });
  const done = (data ?? []).map((x) => x.result as Cycle | undefined).filter((c): c is Cycle => !!c && c.endTs > 0n);
  const total = done.reduce((a, c) => a + c.realizedPnl, 0n);
  const pct = (c: Cycle) => (c.navStart > 0n ? (Number(c.realizedPnl) / Number(c.navStart)) * 100 : 0);
  const signed = (v: bigint, dp = 2) => `${v >= 0n ? "+" : "−"}${fmtUsdg(v < 0n ? -v : v, dp)}`;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-72 space-y-1.5">
          <CardTitle>Cycle history</CardTitle>
          <CardDescription>Realized PnL per cycle (close → next open), before the performance fee. Past cycles don&apos;t predict the next.</CardDescription>
        </div>
        {done.length > 0 && (
          <div className="shrink-0 text-right">
            <p className="text-xs text-muted-foreground">{done.length === 1 ? "Last cycle" : `Last ${done.length} cycles`}</p>
            <p className={cn("font-mono text-lg tabular-nums", total > 0n ? "text-up" : total < 0n ? "text-destructive" : "")}>{signed(total)} USDG</p>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {done.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {active ? "The first cycle is still running. It's booked at the next open." : "No finished cycles yet. The first one starts at the next US cash close."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] font-mono text-xs tabular-nums">
              <thead className="text-left text-[10.5px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-1.5 font-normal">Cycle</th>
                  <th className="font-normal">Closed</th>
                  <th className="text-right font-normal">NAV start</th>
                  <th className="text-right font-normal">NAV end</th>
                  <th className="text-right font-normal">PnL</th>
                  <th className="text-right font-normal">Return</th>
                </tr>
              </thead>
              <tbody>
                {done.map((c) => (
                  <tr key={String(c.id)} className="border-t border-border">
                    <td className="py-2">#{String(c.id)}</td>
                    <td className="text-muted-foreground">{fmtNy(c.endTs)}</td>
                    <td className="text-right">{fmtUsdg(c.navStart)}</td>
                    <td className="text-right">{fmtUsdg(c.navEnd)}</td>
                    <td className={cn("text-right", c.realizedPnl > 0n ? "text-up" : c.realizedPnl < 0n ? "text-destructive" : "")}>{signed(c.realizedPnl, 4)}</td>
                    <td className="text-right">{`${pct(c) >= 0 ? "+" : "−"}${Math.abs(pct(c)).toFixed(2)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
