"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { parseUnits } from "viem";
import { activeChain, isLocal } from "@/lib/chains";
import { deployment, mockAggregatorAbi, mockSwapAdapterAbi, stockTokenAbi } from "@/lib/contracts";
import { useChainNow, useSession, useTx } from "@/lib/hooks";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TxStatus } from "@/components/tx-status";
import { fmtNy } from "@/lib/format";

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

/** Local-anvil-only demo helpers: warp chain time and push mock Chainlink prints. Never rendered on 4663. */
export function DemoControls() {
  const s = useSession();
  const now = useChainNow();
  const qc = useQueryClient();
  const tx = useTx();
  const [px, setPx] = useState("182.00");
  const [warpErr, setWarpErr] = useState<string>();
  if (!isLocal || !deployment) return null;
  const d = deployment;

  const warpTo = async (ts: number) => {
    setWarpErr(undefined);
    try {
      await rpc("evm_setNextBlockTimestamp", [ts]);
      await rpc("evm_mine");
      await qc.invalidateQueries();
    } catch (e) {
      setWarpErr(e instanceof Error ? e.message : String(e));
    }
  };

  const pushPrint = async () => {
    const p8 = parseUnits(px || "0", 8);
    const ok = await tx.send("Push NVDA print", { address: d.nvdaFeed, abi: mockAggregatorAbi, functionName: "setAnswer", args: [p8] });
    if (ok) await tx.send("Sync mock swap venue", { address: d.swapAdapter, abi: mockSwapAdapterAbi, functionName: "setPrice", args: [parseUnits(px, 18)] });
  };

  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="text-base">Local demo controls</CardTitle>
        <CardDescription>
          This panel only exists on local anvil. It warps chain time and pushes mock Chainlink prints. Chain time:{" "}
          {now ? fmtNy(now) : "—"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {s.nextOpen && (
            <Button size="sm" variant="outline" onClick={() => warpTo(Number(s.nextOpen) + 20)}>
              Warp → next open +20s
            </Button>
          )}
          {s.nextClose && (
            <Button size="sm" variant="outline" onClick={() => warpTo(Number(s.nextClose) + 300)}>
              Warp → next close +5m
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => now && warpTo(now + 5 * 60)}>
            +5 min
          </Button>
          <Button size="sm" variant="outline" onClick={() => now && warpTo(now + 61 * 60)}>
            +61 min
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input className="w-32" value={px} onChange={(e) => setPx(e.target.value)} aria-label="NVDA price USD" />
          <Button size="sm" variant="outline" disabled={tx.busy} onClick={pushPrint}>
            Push NVDA/USD print (8 dec)
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={tx.busy}
            onClick={() =>
              tx.send("Toggle oraclePaused", {
                address: d.nvda,
                abi: stockTokenAbi,
                functionName: "setOraclePaused",
                args: [s.freezeReason !== "PAUSED"],
              })
            }
          >
            {s.freezeReason === "PAUSED" ? "Unpause oracle" : "Pause oracle (mock)"}
          </Button>
        </div>
        {warpErr && <p className="text-xs text-destructive">{warpErr}</p>}
        <TxStatus state={tx.state} />
      </CardContent>
    </Card>
  );
}
