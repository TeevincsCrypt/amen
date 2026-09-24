"use client";

import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { deployment, stockTokenAbi, usdgAbi } from "@/lib/contracts";
import { useStocks } from "@/lib/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Stat } from "@/components/stat";
import { fmt18, fmtUsdg } from "@/lib/format";

/**
 * USDG plus every listed Stock Token the wallet holds, raw and share-equivalent side by side.
 * Raw balanceOf is not a share count (ERC-8056): share-equivalent = raw × uiMultiplier.
 */
export function WalletHoldings() {
  const { address } = useAccount();
  const { stocks } = useStocks();
  const enabled = !!deployment && !!address;
  const { data: usdg } = useReadContract({
    address: deployment?.usdg,
    abi: usdgAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled, refetchInterval: 6_000 },
  });
  const { data } = useReadContracts({
    contracts: enabled
      ? stocks.flatMap((s) => [
          { address: s.token, abi: stockTokenAbi, functionName: "balanceOf" as const, args: [address!] as const },
          { address: s.token, abi: stockTokenAbi, functionName: "balanceOfUI" as const, args: [address!] as const },
          { address: s.token, abi: stockTokenAbi, functionName: "uiMultiplier" as const },
        ])
      : [],
    query: { enabled: enabled && stocks.length > 0, refetchInterval: 6_000 },
  });
  if (!address) return null;
  const held = stocks
    .map((s, i) => ({
      symbol: s.symbol,
      raw: data?.[i * 3]?.result as bigint | undefined,
      ui: data?.[i * 3 + 1]?.result as bigint | undefined,
      mult: data?.[i * 3 + 2]?.result as bigint | undefined,
    }))
    .filter((h) => h.raw !== undefined && h.raw > 0n);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your wallet</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <Stat label="USDG" value={fmtUsdg(usdg)} unit="USDG · 6 dec" />
        {held.length === 0 ? (
          <Stat label="Stock Tokens" value="none held" unit="raw and share-equivalent are shown if you hold any" />
        ) : (
          <table className="w-full font-mono text-xs tabular-nums">
            <thead className="text-left text-[10.5px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-1 font-normal">Token</th>
                <th className="text-right font-normal">Raw (balanceOf)</th>
                <th className="text-right font-normal">Share-equiv. (balanceOfUI)</th>
                <th className="text-right font-normal">uiMultiplier</th>
              </tr>
            </thead>
            <tbody>
              {held.map((h) => (
                <tr key={h.symbol} className="border-t border-border">
                  <td className="py-2 font-sans font-medium">{h.symbol}</td>
                  <td className="text-right">{fmt18(h.raw, 6)}</td>
                  <td className="text-right">{fmt18(h.ui, 6)}</td>
                  <td className="text-right">{fmt18(h.mult, 6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-[11px] text-muted-foreground">
          Stock Tokens give economic exposure only, not share ownership. Raw balances are 18 decimals; the share-equivalent
          applies the token&apos;s corporate-action multiplier.
        </p>
      </CardContent>
    </Card>
  );
}
