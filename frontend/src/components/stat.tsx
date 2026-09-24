import { cn } from "@/lib/utils";

/** A labelled number. `unit` always states asset + decimals so nothing is ambiguous. */
export function Stat({ label, value, unit, className, hint }: { label: string; value: React.ReactNode; unit?: string; className?: string; hint?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="truncate text-xl font-semibold tracking-tight">{value}</span>
      {unit && <span className="font-mono text-[10.5px] text-muted-foreground">{unit}</span>}
      {hint && <span className="text-[11px] text-muted-foreground/80">{hint}</span>}
    </div>
  );
}

/** Hero figure: "$182" with the cents de-emphasized, like the dashboard reference. */
export function Figure({ text, className }: { text: string; className?: string }) {
  const m = text.match(/^([^.]*)(\.\d+)?(.*)$/);
  return (
    <span className={cn("font-semibold tracking-tight", className)}>
      {m?.[1] ?? text}
      {m?.[2] && <span className="text-[0.55em] text-muted-foreground">{m[2]}</span>}
      {m?.[3]}
    </span>
  );
}

/** Mono key/value row, as in the reference's exchange panel. */
export function DetailRow({ k, v, className }: { k: string; v: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-4 py-1.5 text-[13px]", className)}>
      <span className="font-mono text-xs text-muted-foreground">{k}</span>
      <span className="text-right font-mono text-foreground">{v}</span>
    </div>
  );
}
