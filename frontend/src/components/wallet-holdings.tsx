"use client";

import { useAccount, useReadContracts } from "wagmi";
import { deployment, stockTokenAbi, usdgAbi } from "@/lib/contracts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Stat } from "@/components/stat";
import { fmt18, fmtUsdg } from "@/lib/format";

/** Shows raw NVDA and share-equivalent side by side. Raw balanceOf is not a share count (ERC-8056). */
export function WalletHoldings() {
  const { address } = useAccount();
  const enabled = !!deployment && !!address;
  const { data } = useReadContracts({
    contracts: enabled
      ? [
          { address: deployment!.usdg, abi: usdgAbi, functionName: "balanceOf", args: [address!] },
          { address: deployment!.nvda, abi: stockTokenAbi, functionName: "balanceOf", args: [address!] },
          { address: deployment!.nvda, abi: stockTokenAbi, functionName: "balanceOfUI", args: [address!] },
          { address: deployment!.nvda, abi: stockTokenAbi, functionName: "uiMultiplier" },
        ]
      : [],
    query: { enabled, refetchInterval: 6_000 },
  });
  if (!address) return null;
  const [usdg, raw, ui, mult] = (data ?? []).map((d) => d?.result as bigint | undefined);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your wallet</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="USDG" value={fmtUsdg(usdg)} unit="USDG · 6 dec" />
        <Stat label="NVDA raw" value={fmt18(raw, 6)} unit="Stock Token balanceOf · 18 dec" />
        <Stat
          label="NVDA share-equivalent"
          value={ui !== undefined ? fmt18(ui, 6) : "—"}
          unit="balanceOfUI = raw × uiMultiplier"
          hint="Economic exposure only, not share ownership"
        />
        <Stat label="uiMultiplier" value={fmt18(mult, 6)} unit="ERC-8056 · 18 dec" />
      </CardContent>
    </Card>
  );
}
