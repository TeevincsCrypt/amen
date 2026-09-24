import type { TxState } from "@/lib/hooks";
import { cn } from "@/lib/utils";

export function TxStatus({ state }: { state: TxState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <p
      role="status"
      className={cn(
        "mt-3 rounded-md border px-3 py-2 text-xs",
        state.status === "error" ? "border-destructive/50 text-destructive" : "border-border text-muted-foreground",
      )}
    >
      {state.message}
      {state.hash && <span className="ml-2 font-mono opacity-60">{state.hash.slice(0, 10)}…</span>}
    </p>
  );
}
