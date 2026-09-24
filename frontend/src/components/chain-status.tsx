"use client";

import { useBlockNumber } from "wagmi";
import { activeChain } from "@/lib/chains";

/** Plain notice when the configured chain RPC can't be reached, instead of silently empty pages. */
export function ChainStatus() {
  const { isError, data } = useBlockNumber({ query: { refetchInterval: 8_000, retry: 1 } });
  if (!isError || data !== undefined) return null;
  const rpc = activeChain.rpcUrls.default.http[0];
  const pointsAtLocalhost = /127\.0\.0\.1|localhost/.test(rpc);
  return (
    <div className="border-b border-destructive/50 bg-destructive/10 px-4 py-2 text-center text-xs text-destructive">
      Can&apos;t reach the Amen chain at <code className="font-mono">{rpc}</code> (chain {activeChain.id}).
      {pointsAtLocalhost &&
        " This build points at a chain on your own computer. Hosted builds need NEXT_PUBLIC_RPC_URL set to the public demo chain."}
    </div>
  );
}
