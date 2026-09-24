import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { TxState } from "@/lib/hooks";
import { cn } from "@/lib/utils";

export function TxStatus({ state, className }: { state: TxState; className?: string }) {
  if (state.status === "idle" || !state.message) return null;
  const Icon = state.status === "error" ? XCircle : state.status === "done" ? CheckCircle2 : Loader2;
  return (
    <p
      role="status"
      className={cn(
        "mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
        state.status === "error" ? "border-destructive/40 bg-destructive/5 text-destructive" : "border-border bg-card-raised text-muted-foreground",
        className,
      )}
    >
      <Icon className={cn("mt-px h-3.5 w-3.5 shrink-0", state.status === "done" && "text-up", (state.status === "signing" || state.status === "mining") && "animate-spin")} />
      <span>
        {state.message}
        {state.hash && <span className="ml-2 font-mono opacity-60">{state.hash.slice(0, 10)}…</span>}
      </span>
    </p>
  );
}
