"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { numberToHex } from "viem";
import { useState } from "react";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { activeChain } from "@/lib/chains";
import { shortAddr } from "@/lib/format";

/** Adds Robinhood Chain to the wallet with the official RPC params, then switches to it. */
async function addChain() {
  const eth = (window as unknown as { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
  if (!eth) throw new Error("No injected wallet found");
  await eth.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: numberToHex(activeChain.id),
        chainName: activeChain.name,
        nativeCurrency: activeChain.nativeCurrency,
        rpcUrls: activeChain.rpcUrls.default.http,
        blockExplorerUrls: activeChain.blockExplorers ? [activeChain.blockExplorers.default.url] : undefined,
      },
    ],
  });
}

export function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connectAsync, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const [err, setErr] = useState<string>();

  const wrongChain = isConnected && chainId !== activeChain.id;

  const ensureChain = async () => {
    setErr(undefined);
    try {
      await switchChainAsync({ chainId: activeChain.id });
    } catch {
      try {
        await addChain();
        await switchChainAsync({ chainId: activeChain.id });
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    }
  };

  if (!isConnected) {
    return (
      <div className="flex flex-col items-end">
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={async () => {
            setErr(undefined);
            try {
              const c = connectors[0];
              if (!c) throw new Error("No injected wallet found");
              await connectAsync({ connector: c, chainId: activeChain.id });
            } catch {
              // Most failures are "chain not added": add it with the official params, then retry.
              try {
                await addChain();
                await connectAsync({ connector: connectors[0], chainId: activeChain.id });
              } catch (e2) {
                setErr(e2 instanceof Error ? e2.message.split("\n")[0] : String(e2));
              }
            }
          }}
        >
          <Wallet className="h-3.5 w-3.5" />
          {isPending ? "Connecting…" : "Connect wallet"}
        </Button>
        {err && <span className="mt-1 max-w-[16rem] text-right text-[11px] text-destructive">{err}</span>}
      </div>
    );
  }

  if (wrongChain) {
    return (
      <div className="flex flex-col items-end">
        <Button size="sm" variant="destructive" onClick={ensureChain}>
          Switch to {activeChain.name}
        </Button>
        {err && <span className="mt-1 text-[11px] text-destructive">{err}</span>}
      </div>
    );
  }

  return (
    <button
      onClick={() => disconnect()}
      title="Disconnect"
      className="inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-card-raised px-3 font-mono text-xs text-muted-foreground hover:text-foreground"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-up" />
      {shortAddr(address)}
    </button>
  );
}
