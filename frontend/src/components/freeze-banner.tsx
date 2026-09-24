"use client";

import { useState } from "react";
import Link from "next/link";
import { usePublicClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCcw, Send, Snowflake } from "lucide-react";
import { useSession } from "@/lib/hooks";
import { isLocal } from "@/lib/chains";
import { decodeError } from "@/lib/errors";
import { demoRewind, demoSend, PRINT_182 } from "@/lib/demo-actions";
import { Button } from "@/components/ui/button";

const EXPLAIN: Record<string, string> = {
  STALE:
    "US cash is open but the NVDA Chainlink feed hasn't updated in over 30 minutes. Amen won't price anything off a stale mark while the market is trading.",
  PAUSED: "The Stock Token reports oraclePaused() = true, so Amen has stopped trusting its price.",
  NONPOSITIVE: "The feed returned a price of zero or less.",
  FEED_ERROR: "The price feed call failed or returned invalid data.",
  MANUAL: "The protocol owner has frozen Amen (emergency switch).",
};

/**
 * Demo chain only: the mock feed updates only when the demo publishes a price, so a STALE
 * freeze at Monday's open (step 7) or ~30 min after the last print is expected. Offer the two
 * ways out right here: publish a fresh price (the step-8 action), or rewind the demo to Friday.
 */
function DemoRecovery({ reason, compact = false }: { reason: string; compact?: boolean }) {
  const client = usePublicClient();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string>();
  const [err, setErr] = useState<string>();
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setErr(undefined);
    try {
      await fn();
    } catch (e) {
      setErr(decodeError(e));
    } finally {
      setBusy(undefined);
      await qc.invalidateQueries();
    }
  };
  const stale = reason === "STALE";
  const buttons = (
    <>
      {stale && (
        <Button size={compact ? "sm" : "default"} disabled={!!busy || !client} onClick={() => run("print", () => demoSend(client!, "owner", PRINT_182))}>
          {busy === "print" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Publish a fresh $182.00 price
        </Button>
      )}
      <Button size={compact ? "sm" : "default"} variant="outline" disabled={!!busy || !client} onClick={() => run("rewind", () => demoRewind(client!))}>
        {busy === "rewind" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
        Rewind to Friday 16:02
      </Button>
    </>
  );

  if (compact) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        {buttons}
        {err && <span className="text-destructive">{err}</span>}
      </span>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-primary/25 bg-primary/[0.06] p-4 text-left">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">Demo chain · this freeze is expected</p>
      <p className="text-sm text-foreground/90">
        The mock NVDA feed only updates when the demo publishes a price.
        {stale ? (
          <>
            {" "}
            Just ran <strong className="font-medium">step 7</strong> (warp to Monday)? Publish Monday&apos;s price to continue.
            Finished the demo a while ago? Rewind to Friday to start over.
          </>
        ) : (
          " Rewind the demo to Friday to start over."
        )}
      </p>
      <div className="flex flex-wrap gap-2">{buttons}</div>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}

/** Full-screen, honest freeze notice. It isn't a toast: you acknowledge it, then continue read-only. */
export function FreezeBanner() {
  const s = useSession();
  const [ack, setAck] = useState<string>();
  if (!s.frozen) return null;
  const reason = s.freezeReason || "UNKNOWN";

  if (ack === reason) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-2 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-center text-xs text-destructive">
        <Snowflake className="h-3.5 w-3.5" />
        Amen is frozen ({reason}). Swaps, new positions and resolution are paused.{" "}
        <Link href="/risk" className="underline underline-offset-2">
          Why?
        </Link>
        {isLocal && <DemoRecovery reason={reason} compact />}
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
        {isLocal && <DemoRecovery reason={reason} />}
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
