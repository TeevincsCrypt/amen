import { cn } from "@/lib/utils";

/** A labelled number. `unit` always states asset + decimals so nothing is ambiguous. */
export function Stat({ label, value, unit, className, hint }: { label: string; value: React.ReactNode; unit?: string; className?: string; hint?: string }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
      <span className="font-mono text-lg tabular-nums">{value}</span>
      {unit && <span className="text-[11px] text-muted-foreground">{unit}</span>}
      {hint && <span className="text-[11px] text-muted-foreground/80">{hint}</span>}
    </div>
  );
}
