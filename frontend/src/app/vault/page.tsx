"use client";

import { useState } from "react";
import { useAccount, useReadContracts } from "wagmi";
import { parseUnits, maxUint256 } from "viem";
import { deployment, vespersVaultAbi, usdgAbi } from "@/lib/contracts";
import { useRoles, useSession, useTx } from "@/lib/hooks";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Stat } from "@/components/stat";
import { TxStatus } from "@/components/tx-status";
import { WalletHoldings } from "@/components/wallet-holdings";
import { NoDeployment } from "@/components/no-deployment";
import { fmt18, fmtNy, fmtUsd18, fmtUsdg, fmtBps } from "@/lib/format";
import { cn } from "@/lib/utils";

type Cycle = { id: bigint; startTs: bigint; endTs: bigint; navStart: bigint; navEnd: bigint; realizedPnl: bigint; perfFee: bigint };

export default function VaultPage() {
  if (!deployment) return <NoDeployment />;
  return <Vault />;
}

function Vault() {
  const d = deployment!;
  const { address } = useAccount();
  const session = useSession();
  const roles = useRoles(d.vault, vespersVaultAbi);
  const tx = useTx();
  const [depositAmt, setDepositAmt] = useState("100");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [buyAmt, setBuyAmt] = useState("40");

  const v = { address: d.vault, abi: vespersVaultAbi } as const;
  const { data } = useReadContracts({
    contracts: [
      { ...v, functionName: "inventory" },
      { ...v, functionName: "totalSupply" },
      { ...v, functionName: "convertToAssets", args: [10n ** 18n] },
      { ...v, functionName: "currentCycleId" },
      { ...v, functionName: "cycleActive" },
      { ...v, functionName: "cycleNetFlows" },
      { ...v, functionName: "maxInventoryBps" },
      { ...v, functionName: "perfFeeBps" },
      { ...v, functionName: "accruedFees" },
      { ...v, functionName: "balanceOf", args: [address ?? "0x0000000000000000000000000000000000000000"] },
      { address: d.usdg, abi: usdgAbi, functionName: "allowance", args: [address ?? "0x0000000000000000000000000000000000000000", d.vault] },
    ],
    query: { refetchInterval: 4_000 },
  });
  const r = (i: number) => data?.[i]?.result;
  const inv = r(0) as readonly [bigint, bigint, bigint, bigint, bigint, boolean, `0x${string}`] | undefined;
  const [usdgFree, stockRaw, stockValue, nav] = inv ?? [];
  const supply = r(1) as bigint | undefined;
  const sharePrice = r(2) as bigint | undefined;
  const cycleId = r(3) as bigint | undefined;
  const cycleActive = r(4) as boolean | undefined;
  const netFlows = r(5) as bigint | undefined;
  const maxInvBps = r(6) as bigint | undefined;
  const perfFeeBps = r(7) as bigint | undefined;
  const fees = r(8) as bigint | undefined;
  const myShares = r(9) as bigint | undefined;
  const allowance = r(10) as bigint | undefined;

  const { data: cyc } = useReadContracts({
    contracts:
      cycleId && cycleId > 0n
        ? [
            { ...v, functionName: "cycles", args: [cycleId] },
            { ...v, functionName: "convertToAssets", args: [myShares ?? 0n] },
          ]
        : [{ ...v, functionName: "convertToAssets", args: [myShares ?? 0n] }],
    query: { refetchInterval: 4_000 },
  });
  const current = cycleId && cycleId > 0n ? (cyc?.[0]?.result as Cycle | undefined) : undefined;
  const myValue = (cycleId && cycleId > 0n ? cyc?.[1]?.result : cyc?.[0]?.result) as bigint | undefined;

  const holdsStock = (stockRaw ?? 0n) > 0n;
  const locked = holdsStock && !session.cashOpen;
  const frozenLock = session.frozen && (holdsStock || session.cashOpen);
  const stockPct = nav && nav > 0n && stockValue !== undefined ? Number((stockValue * 10000n) / nav) / 100 : 0;

  const deposit = async () => {
    const amt = parseUnits(depositAmt || "0", 6);
    if ((allowance ?? 0n) < amt) {
      const ok = await tx.send("Approve USDG", { address: d.usdg, abi: usdgAbi, functionName: "approve", args: [d.vault, maxUint256] });
      if (!ok) return;
    }
    await tx.send("Deposit", { ...v, functionName: "deposit", args: [amt, address!] });
  };

  const withdraw = async () => {
    if (!withdrawAmt) {
      await tx.send("Redeem all", { ...v, functionName: "redeem", args: [myShares ?? 0n, address!, address!] });
    } else {
      await tx.send("Withdraw", { ...v, functionName: "withdraw", args: [parseUnits(withdrawAmt, 6), address!, address!] });
    }
  };

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.3em] text-vespers">Vespers Vault · NVDA / USDG</p>
        <h1 className="font-serif text-4xl">Inventory for the hours the market sleeps.</h1>
        <p className="max-w-2xl text-muted-foreground">
          You deposit USDG and get vault shares (vspNVDA, 18 decimals). NAV = free USDG + NVDA held × Chainlink mark. The
          Stock Token&apos;s uiMultiplier is never applied to the price.
        </p>
      </header>

      {(locked || frozenLock) && (
        <div className="rounded-md border border-vespers/40 bg-vespers/5 px-4 py-3 text-sm text-vespers">
          {frozenLock
            ? `Oracle frozen (${session.freezeReason}). Deposits and withdrawals are locked until the mark is healthy.`
            : "The vault is carrying NVDA through Vespers. Its weekend mark may be stale, so deposits and withdrawals reopen after the next flatten (in USDG)."}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Net asset value</CardTitle>
            <CardDescription>All USDG figures have 6 decimals. Shares have 18.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
              <Stat label="NAV" value={fmtUsdg(nav)} unit="USDG · 6 dec" />
              <Stat label="Share price" value={fmtUsdg(sharePrice, 6)} unit="USDG per 1 vspNVDA" />
              <Stat label="Shares outstanding" value={fmt18(supply, 2)} unit="vspNVDA · 18 dec" />
              <Stat label="NVDA mark" value={fmtUsd18(session.markPrice)} unit="USD · Chainlink → 18 dec" />
            </div>
            <div>
              <div className="mb-2 flex justify-between text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                <span>Inventory split</span>
                <span>max {fmtBps(maxInvBps)} NVDA</span>
              </div>
              <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                <div className="bg-cash/70" style={{ width: `${100 - stockPct}%` }} />
                <div className="bg-vespers/80" style={{ width: `${stockPct}%` }} />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-4">
                <Stat label="USDG free" value={fmtUsdg(usdgFree)} unit="USDG · 6 dec" />
                <Stat label="NVDA held" value={fmt18(stockRaw, 6)} unit="raw NVDA · 18 dec" />
                <Stat label="NVDA value" value={fmtUsdg(stockValue)} unit={`USDG · 6 dec · ${stockPct.toFixed(2)}%`} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cycle</CardTitle>
            <CardDescription>A cycle runs from the close to the next open, and PnL is realized at the flatten.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Cycle #" value={cycleId?.toString() ?? "—"} unit={cycleActive ? "active" : "idle"} />
              <Stat label="Perf fee" value={fmtBps(perfFeeBps)} unit="of positive realized PnL" />
            </div>
            {current && (
              <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
                <Stat label="NAV start" value={fmtUsdg(current.navStart)} unit={fmtNy(current.startTs)} />
                <Stat
                  label={cycleActive ? "Net LP flows" : "NAV end"}
                  value={cycleActive ? fmtUsdg(netFlows) : fmtUsdg(current.navEnd)}
                  unit={cycleActive ? "USDG · in-cycle" : fmtNy(current.endTs)}
                />
                {!cycleActive && (
                  <>
                    <Stat
                      label="Realized PnL"
                      value={
                        <span className={cn(current.realizedPnl > 0n ? "text-cash" : current.realizedPnl < 0n ? "text-destructive" : "")}>
                          {current.realizedPnl >= 0n ? "+" : "−"}
                          {fmtUsdg(current.realizedPnl < 0n ? -current.realizedPnl : current.realizedPnl, 6)}
                        </span>
                      }
                      unit="USDG · 6 dec, before fee"
                    />
                    <Stat label="Perf fee" value={fmtUsdg(current.perfFee, 6)} unit="USDG · to feeRecipient" />
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Deposit USDG</CardTitle>
            <CardDescription>You receive vspNVDA shares at the current NAV.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input value={depositAmt} onChange={(e) => setDepositAmt(e.target.value)} inputMode="decimal" aria-label="USDG amount" />
              <Button disabled={!address || tx.busy} onClick={deposit}>
                Deposit
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Amount in USDG (6 decimals).</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Withdraw</CardTitle>
            <CardDescription>
              Your position: {fmt18(myShares, 4)} vspNVDA ≈ {fmtUsdg(myValue)} USDG
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input value={withdrawAmt} onChange={(e) => setWithdrawAmt(e.target.value)} placeholder="blank = redeem all" inputMode="decimal" aria-label="USDG to withdraw" />
              <Button variant="outline" disabled={!address || tx.busy || !myShares} onClick={withdraw}>
                Withdraw
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Paid in USDG (6 decimals). In-kind exits are disabled in Phase 1.</p>
          </CardContent>
        </Card>
      </div>
      <TxStatus state={tx.state} />

      <WalletHoldings />

      {roles.canOperate && (
        <Card className="border-gilt/30">
          <CardHeader>
            <CardTitle className="text-base">Keeper console</CardTitle>
            <CardDescription>
              Inventory can only be added during Vespers, up to {fmtBps(maxInvBps)} of NAV, within 0.5% (50 bps) of the oracle mark.
              Flattening is allowed in any session. Accrued fees: {fmtUsdg(fees, 6)} USDG.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={tx.busy} onClick={() => tx.send("Start cycle", { ...v, functionName: "startCycle" })}>
              Start cycle
            </Button>
            <Input className="w-28" value={buyAmt} onChange={(e) => setBuyAmt(e.target.value)} aria-label="USDG to spend" />
            <Button
              size="sm"
              variant="outline"
              disabled={tx.busy}
              onClick={() => tx.send("Buy NVDA inventory", { ...v, functionName: "buyInventory", args: [parseUnits(buyAmt || "0", 6), 0n] })}
            >
              Buy NVDA (USDG)
            </Button>
            <Button size="sm" variant="outline" disabled={tx.busy} onClick={() => tx.send("Flatten", { ...v, functionName: "flatten", args: [0n] })}>
              Flatten
            </Button>
            <Button size="sm" variant="outline" disabled={tx.busy} onClick={() => tx.send("End cycle", { ...v, functionName: "endCycle" })}>
              End cycle
            </Button>
            <Button size="sm" variant="ghost" disabled={tx.busy || !fees} onClick={() => tx.send("Claim fees", { ...v, functionName: "claimFees" })}>
              Claim fees
            </Button>
          </CardContent>
        </Card>
      )}

    </div>
  );
}
