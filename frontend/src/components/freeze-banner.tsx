"use client";

import { useState } from "react";
import Link from "next/link";
import { Snowflake } from "lucide-react";
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

/** Full-screen, honest freeze notice. It isn't a toast: you acknowledge it, then continue read-only. */
export function FreezeBanner() {
  const s = useSession();
  const [ack, setAck] = useState<string>();
  if (!s.frozen) return null;
  const reason = s.freezeReason || "UNKNOWN";

  if (ack === reason) {
    return (
      <div className="flex items-center justify-center gap-2 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-center text-xs text-destructive">
        <Snowflake className="h-3.5 w-3.5" />
        Amen is frozen ({reason}). Swaps, new positions and resolution are paused.{" "}
        <Link href="/risk" className="underline underline-offset-2">
          Why?
        </Link>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-6 backdrop-blur-md" role="alertdialog" aria-modal>
      <div className="w-full max-w-lg space-y-5 rounded-xl border border-destructive/30 bg-card p-7 text-center shadow-2xl">
        <span className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10">
          <Snowflake className="h-5 w-5 text-destructive" />
        </span>
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-destructive">Frozen · {reason}</p>
        <h2 className="text-3xl font-semibold tracking-tight">Amen is not quoting.</h2>
        <p className="text-muted-foreground">{EXPLAIN[reason] ?? "The oracle reported bad data."}</p>
        <p className="text-sm text-muted-foreground">
          While frozen: no new market positions, no vault swaps, and no resolution. The vault locks if it holds NVDA (or
          during a cash-open freeze). Markets that can&apos;t resolve within 60 minutes of their resolve time become voidable,
          and every stake is refunded 1:1. Your balances are not affected.
        </p>
        <div className="flex justify-center gap-2">
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
