"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type Segment = { label: string; value: number; display: string; color: "s1" | "s2" };

const FILL = { s1: "bg-s1", s2: "bg-s2" } as const;

/**
 * Two-part proportion bar (identity: validated s1/s2 pair). A 2px surface gap separates
 * segments, and a legend is always shown, so identity never relies on color alone.
 * Hovering or focusing a segment shows its value; the legend also carries every value.
 */
export function SplitBar({ segments, className, marker }: { segments: Segment[]; className?: string; marker?: { at: number; label: string } }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = segments.reduce((a, s) => a + s.value, 0);
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);
  return (
    <div className={cn("space-y-2.5", className)}>
      <div className="relative">
        <div className="flex h-2.5 gap-[2px] overflow-visible rounded-full">
          {total === 0 ? (
            <div className="h-full w-full rounded-full bg-muted" />
          ) : (
            segments.map((s, i) =>
              s.value > 0 ? (
                <button
                  key={s.label}
                  type="button"
                  aria-label={`${s.label}: ${s.display} (${pct(s.value).toFixed(1)}%)`}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className={cn(
                    "relative h-full transition-[filter] first:rounded-l-full last:rounded-r-full focus:outline-none",
                    FILL[s.color],
                    hover === i && "brightness-125",
                  )}
                  style={{ width: `${pct(s.value)}%` }}
                >
                  {hover === i && (
                    <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-card-raised px-2 py-1 text-left shadow-lg">
                      <span className="block font-mono text-xs font-medium text-foreground">{s.display}</span>
                      <span className="block text-[10px] text-muted-foreground">
                        {s.label} · {pct(s.value).toFixed(1)}%
                      </span>
                    </span>
                  )}
                </button>
              ) : null,
            )
          )}
        </div>
        {marker && (
          <div className="pointer-events-none absolute -top-1 h-[18px] w-px bg-foreground/70" style={{ left: `${marker.at}%` }}>
            <span className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[9px] text-muted-foreground">{marker.label}</span>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {segments.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <span className={cn("h-2 w-2 rounded-[2px]", FILL[s.color])} />
            {s.label}
            <span className="font-mono text-foreground">{s.display}</span>
            <span className="font-mono">{pct(s.value).toFixed(1)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}
