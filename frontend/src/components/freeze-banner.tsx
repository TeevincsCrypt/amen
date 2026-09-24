"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession } from "@/lib/hooks";
import { Button } from "@/components/ui/button";

const EXPLAIN: Record<string, string> = {
  STALE:
    "US cash is open but the NVDA Chainlink feed hasn't updated in over 30 minutes. Amen won't price anything off a stale mark while the market is trading.",
  PAUSED: "The Stock Token reports oraclePaused() = true, so Amen has stopped trusting its price.",
  NONPOSITIVE: "The feed returned a price of zero or less.",
  FEED_ERROR: "The price feed call failed or returned invalid data.",
  MANUAL: "The protocol owner has frozen Amen (emergency switch).",
};

/** Full-screen, honest freeze notice. It isn't a toast: you have to read it before continuing (read-only). */
export function FreezeBanner() {
  const s = useSession();
  const [ack, setAck] = useState<string>();
  if (!s.frozen) return null;
  const reason = s.freezeReason || "UNKNOWN";

  if (ack === reason) {
    return (
      <div className="sticky top-0 z-40 border-b border-destructive/50 bg-destructive/15 px-4 py-2 text-center text-xs text-destructive">
        Amen is FROZEN ({reason}). Vault entry/exit with inventory, swaps, new positions and resolution are paused.{" "}
        <Link href="/risk" className="underline">
          Why?
        </Link>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-6 backdrop-blur" role="alertdialog" aria-modal>
      <div className="max-w-xl space-y-5 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-destructive">Frozen · {reason}</p>
        <h2 className="font-serif text-4xl">Amen is not quoting.</h2>
        <p className="text-muted-foreground">{EXPLAIN[reason] ?? "The oracle reported bad data."}</p>
        <p className="text-sm text-muted-foreground">
          While frozen: no new market positions, no vault swaps, and no resolution. The vault locks if it holds NVDA (or
          during a cash-open freeze). Markets that can&apos;t resolve within 60 minutes of their resolve time become voidable,
          and every stake is refunded 1:1. Your balances are not affected.
        </p>
        <div className="flex justify-center gap-3">
          <Button variant="outline" onClick={() => setAck(reason)}>
            Continue read-only
          </Button>
          <Link href="/risk">
            <Button variant="ghost">Read the rules</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
