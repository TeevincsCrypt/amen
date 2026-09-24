"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { numberToHex } from "viem";
import { useEffect, useRef, useState } from "react";
import { QrCode, Wallet } from "lucide-react";
import type { Connector } from "wagmi";
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
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

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

  const connectWith = async (c: Connector | undefined) => {
    setErr(undefined);
    setOpen(false);
    if (!c) return setErr("No browser wallet found. Use WalletConnect, or install MetaMask or Rabby.");
    try {
      await connectAsync({ connector: c, chainId: activeChain.id });
    } catch (e) {
      if (c.type !== "injected") {
        setErr(e instanceof Error ? e.message.split("\n")[0] : String(e));
        return;
      }
      // Most browser-wallet failures are "chain not added": add it with the official params, then retry.
      try {
        await addChain();
        await connectAsync({ connector: c, chainId: activeChain.id });
      } catch (e2) {
        setErr(e2 instanceof Error ? e2.message.split("\n")[0] : String(e2));
      }
    }
  };

  // Browser wallets announced via EIP-6963 (MetaMask, Rabby…) by name; the generic one otherwise.
  const announced = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
  const browserWallets = announced.length ? announced : connectors.filter((c) => c.id === "injected");
  const wc = connectors.find((c) => c.type === "walletConnect");

  if (!isConnected) {
    return (
      <div ref={boxRef} className="relative flex flex-col items-end">
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          aria-expanded={wc ? open : undefined}
          onClick={() => (wc ? setOpen((o) => !o) : connectWith(browserWallets[0]))}
        >
          <Wallet className="h-3.5 w-3.5" />
          {isPending ? "Connecting…" : "Connect wallet"}
        </Button>
        {open && wc && (
          <div role="menu" className="absolute right-0 top-10 z-50 w-64 space-y-1 rounded-xl border border-border bg-card p-1.5 shadow-xl">
            {browserWallets.map((c) => (
              <button key={c.uid} role="menuitem" onClick={() => connectWith(c)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-muted">
                {c.icon ? (
                  // Wallet icons arrive as data: URIs from EIP-6963, so next/image has nothing to optimize.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.icon} alt="" className="h-5 w-5 rounded" />
                ) : (
                  <Wallet className="h-5 w-5 text-muted-foreground" />
                )}
                <span>
                  <span className="block text-sm">{c.id === "injected" ? "Browser wallet" : c.name}</span>
                  <span className="block text-[11px] text-muted-foreground">{c.id === "injected" ? "MetaMask, Rabby and other extensions" : "Browser extension"}</span>
                </span>
              </button>
            ))}
            <button role="menuitem" onClick={() => connectWith(wc)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-muted">
              <QrCode className="h-5 w-5 text-primary" />
              <span>
                <span className="block text-sm">WalletConnect</span>
                <span className="block text-[11px] text-muted-foreground">Scan with a mobile wallet</span>
              </span>
            </button>
          </div>
        )}
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
