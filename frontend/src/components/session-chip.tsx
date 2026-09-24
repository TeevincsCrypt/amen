"use client";

import { useChainNow, useSession } from "@/lib/hooks";
import { Badge } from "@/components/ui/badge";
import { fmtCountdown, fmtNy } from "@/lib/format";
import { cn } from "@/lib/utils";

export function SessionChip({ large = false }: { large?: boolean }) {
  const s = useSession();
  const now = useChainNow();
  const variant = s.state === "FROZEN" ? "frozen" : s.state === "CASH OPEN" ? "cash" : s.state === "VESPERS" ? "vespers" : "default";
  const target = s.cashOpen ? s.nextClose : s.nextOpen;
  const label = s.cashOpen ? "Cash closes" : "Cash opens";
  const remaining = target && now ? Number(target) - now : undefined;

  if (!large) {
    return (
      <Badge variant={variant} title={s.freezeReason ? `Frozen: ${s.freezeReason}` : undefined} className="h-7 whitespace-nowrap">
        <span className={cn("h-1.5 w-1.5 rounded-full bg-current", s.state !== "FROZEN" && "animate-pulse-dot")} />
        {s.state === "UNKNOWN" ? "…" : s.state}
        {remaining !== undefined && s.state !== "FROZEN" && (
          <span className="font-mono normal-case tracking-normal opacity-80">{fmtCountdown(remaining)}</span>
        )}
      </Badge>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Badge variant={variant} className="w-fit">
        <span className={cn("h-1.5 w-1.5 rounded-full bg-current", s.state !== "FROZEN" && "animate-pulse-dot")} />
        {s.state === "UNKNOWN" ? "Reading chain…" : s.state}
        {s.state === "FROZEN" && s.freezeReason && <span className="normal-case tracking-normal">· {s.freezeReason}</span>}
      </Badge>
      <div className="text-4xl font-semibold tracking-tight">{remaining !== undefined ? fmtCountdown(remaining) : "—"}</div>
      <div className="space-y-1 text-[13px] text-muted-foreground">
        <p>
          {label} <span className="text-foreground">{target ? fmtNy(target) : "—"}</span>
        </p>
        <p className="font-mono text-[11px]">America/New_York · chain time {now ? fmtNy(now) : "—"}</p>
      </div>
    </div>
  );
}
