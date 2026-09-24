"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatUnits } from "viem";
import type { RoundPoint } from "@/lib/hooks";
import { cashSessions, isCashAt } from "@/lib/session";
import { fmtNy } from "@/lib/format";

const LINE = "#38CFF2";
const H = 260;
const PAD = { l: 8, r: 56, t: 16, b: 28 };

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    setW(Math.max(260, ref.current.clientWidth));
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

/** 3–4 round tick values covering [lo, hi] (steps of 1/2/2.5/5 × 10^k). */
function niceTicks(lo: number, hi: number): number[] {
  const raw = (hi - lo) / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

const usd = (v: number) => "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * A Stock Token's Chainlink rounds (e.g. NVDA/USD) as a step line (a round's price holds until the next round).
 * Vespers (cash closed, regular hours) is shaded. Crosshair + tooltip on hover/focus,
 * plus a table view, so no value is hover-only.
 */
export function RoundsChart({ points, now, symbol = "NVDA" }: { points: RoundPoint[]; now: number; symbol?: string }) {
  const { ref, w } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const pts = useMemo(() => points.map((p) => ({ ...p, v: Number(formatUnits(p.price, 18)) })), [points]);
  const first = pts[0]?.ts ?? now - 6 * 3600;
  const t1 = Math.max(now, (pts[pts.length - 1]?.ts ?? now) + 60);
  const span = Math.max(t1 - first, 2 * 3600);
  const t0 = Math.min(first - span * 0.12, t1 - 2 * 3600);

  const vals = pts.map((p) => p.v);
  const lo = vals.length ? Math.min(...vals) : 0;
  const hi = vals.length ? Math.max(...vals) : 1;
  const pad = Math.max((hi - lo) * 0.35, hi * 0.006, 0.5);
  const y0 = lo - pad;
  const y1 = hi + pad;

  const iw = w - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const X = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * iw;
  const Y = (v: number) => PAD.t + (1 - (v - y0) / (y1 - y0)) * ih;

  const closed = useMemo(() => {
    const open = cashSessions(t0, t1);
    const gaps: [number, number][] = [];
    let cur = t0;
    for (const [a, b] of open) {
      if (a > cur) gaps.push([cur, a]);
      cur = Math.max(cur, b);
    }
    if (cur < t1) gaps.push([cur, t1]);
    return gaps;
  }, [t0, t1]);

  let d = "";
  pts.forEach((p, i) => {
    const x = X(p.ts);
    const nx = X(i + 1 < pts.length ? pts[i + 1].ts : t1);
    d += `${i ? "L" : "M"}${x.toFixed(1)} ${Y(p.v).toFixed(1)} H${nx.toFixed(1)} `;
  });
  const area = pts.length ? `${d} V${PAD.t + ih} H${X(pts[0].ts).toFixed(1)} Z` : "";

  const ticks = niceTicks(y0, y1);
  const xTicks = [t0 + (t1 - t0) * 0.02, t0 + (t1 - t0) * 0.5, t1];

  const onMove = (clientX: number, rect: DOMRect) => {
    const t = t0 + ((clientX - rect.left - PAD.l) / iw) * (t1 - t0);
    let idx: number | null = null;
    for (let i = 0; i < pts.length; i++) if (pts[i].ts <= t) idx = i;
    setHover(idx);
  };

  const hp = hover !== null ? pts[hover] : undefined;

  return (
    <div className="space-y-3">
      <div ref={ref} className="relative w-full min-w-0 select-none" style={{ height: H }}>
        {w > 0 && (
        <svg
          width={w}
          height={H}
          className="block touch-none outline-none"
          role="img"
          aria-label={`${symbol}/USD Chainlink rounds, ${pts.length} points${pts.length ? `, latest ${usd(pts[pts.length - 1].v)}` : ""}`}
          tabIndex={0}
          onPointerMove={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(pts.length ? pts.length - 1 : null)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (!pts.length) return;
            if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? pts.length - 1) - 1));
            if (e.key === "ArrowRight") setHover((h) => Math.min(pts.length - 1, (h ?? 0) + 1));
          }}
        >
          <defs>
            <linearGradient id="rc-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={LINE} stopOpacity=".2" />
              <stop offset="1" stopColor={LINE} stopOpacity="0" />
            </linearGradient>
            <pattern id="rc-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="8" stroke={LINE} strokeOpacity=".08" strokeWidth="3" />
            </pattern>
          </defs>
          {closed.map(([a, b]) => (
            <g key={a}>
              <rect x={X(a)} y={PAD.t} width={Math.max(0, X(b) - X(a))} height={ih} fill="url(#rc-hatch)" />
              <rect x={X(a)} y={PAD.t} width={Math.max(0, X(b) - X(a))} height={ih} fill={LINE} fillOpacity=".04" />
            </g>
          ))}
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={PAD.l + iw} y1={Y(v)} y2={Y(v)} stroke="hsl(var(--border))" />
              <text x={w - 4} y={Y(v) + 3} textAnchor="end" className="fill-muted-foreground font-mono text-[10px] tabular-nums">
                {usd(v)}
              </text>
            </g>
          ))}
          {xTicks.map((t, i) => (
            <text key={i} x={X(t)} y={H - 8} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} className="fill-muted-foreground font-mono text-[10px]">
              {fmtNy(Math.round(t)).replace(/,? (EDT|EST)$/, "")}
            </text>
          ))}
          {pts.length > 0 && (
            <>
              <path d={area} fill="url(#rc-area)" />
              <path d={d} fill="none" stroke={LINE} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={X(pts[pts.length - 1].ts)} cy={Y(pts[pts.length - 1].v)} r="4.5" fill={LINE} stroke="hsl(var(--card))" strokeWidth="2" />
            </>
          )}
          {hp && (
            <>
              <line x1={X(hp.ts)} x2={X(hp.ts)} y1={PAD.t} y2={PAD.t + ih} stroke="hsl(var(--foreground))" strokeOpacity=".35" />
              <circle cx={X(hp.ts)} cy={Y(hp.v)} r="5" fill={LINE} stroke="hsl(var(--card))" strokeWidth="2" />
            </>
          )}
        </svg>
        )}
        {hp && (
          <div
            className="pointer-events-none absolute top-3 z-10 w-max rounded-lg border border-border bg-card-raised/95 px-3 py-2 shadow-xl backdrop-blur"
            style={{ left: Math.min(Math.max(X(hp.ts) + 12, 8), w - 190) }}
          >
            <p className="font-mono text-sm font-semibold tabular-nums text-foreground">{usd(hp.v)}</p>
            <p className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: LINE }} />
              Round {hp.roundId.toString()} · {fmtNy(hp.ts)}
            </p>
            <p className="text-[11px] text-muted-foreground">{isCashAt(hp.ts) ? "Printed during cash hours" : "Printed while cash closed"}</p>
          </div>
        )}
        {pts.length === 0 && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">No feed rounds yet.</p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-0.5 w-4 rounded-full" style={{ background: LINE }} /> {symbol}/USD mark (Chainlink rounds)
          </span>
          <span className="inline-flex items-center gap-2">
            <svg width="14" height="10" aria-hidden>
              <rect width="14" height="10" rx="2" fill="url(#rc-hatch)" />
              <rect width="14" height="10" rx="2" fill={LINE} fillOpacity=".08" />
            </svg>
            Vespers: cash closed (regular hours, holidays not shaded)
          </span>
        </div>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none hover:text-foreground">Table view</summary>
          <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-border">
            <table className="w-full font-mono text-[11px] tabular-nums">
              <thead className="sticky top-0 bg-card-raised text-left">
                <tr>
                  <th className="px-3 py-1.5 font-normal">Round</th>
                  <th className="px-3 py-1.5 font-normal">Published (New York)</th>
                  <th className="px-3 py-1.5 text-right font-normal">USD</th>
                </tr>
              </thead>
              <tbody>
                {[...pts].reverse().map((p) => (
                  <tr key={p.roundId.toString()} className="border-t border-border">
                    <td className="px-3 py-1.5">{p.roundId.toString()}</td>
                    <td className="px-3 py-1.5">{fmtNy(p.ts)}</td>
                    <td className="px-3 py-1.5 text-right text-foreground">{usd(p.v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </div>
  );
}
