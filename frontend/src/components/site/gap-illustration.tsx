/**
 * Illustration (not data): how an overnight gap looks to Amen. Friday's session trades,
 * the Chainlink mark goes stale over the weekend (expected), and Monday's first
 * cash-session print settles the market. Numbers match the demo scenario.
 */
const W = 640;
const H = 300;
const X = { fri: 20, close: 250, open: 470, end: 620 };
const Y0 = 64; // top of plot
const Y1 = 244; // baseline
const P = { lo: 176.5, hi: 183.5 };
const y = (px: number) => Y1 - ((px - P.lo) / (P.hi - P.lo)) * (Y1 - Y0);

function walk(n: number, start: number, end: number, seed: number, amp: number) {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296) - 0.5;
  const pts: number[] = [];
  let v = start;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    v += rnd() * amp;
    pts.push(v * (1 - t) + (start + (end - start) * t) * t); // drift toward `end`
  }
  pts[n - 1] = end;
  return pts;
}

const fri = walk(44, 178.4, 180, 7, 0.9);
const mon = walk(22, 182, 182.35, 11, 0.7);
const toPath = (xs: [number, number], vs: number[]) =>
  vs.map((v, i) => `${i ? "L" : "M"}${(xs[0] + ((xs[1] - xs[0]) * i) / (vs.length - 1)).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");

const friPath = toPath([X.fri, X.close], fri);
const monPath = toPath([X.open + 8, X.end], mon);

export function GapIllustration() {
  return (
    <figure className="relative overflow-hidden rounded-xl border border-border bg-card/90 shadow-2xl shadow-black/40 backdrop-blur">
      <figcaption className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <p className="font-mono text-[11px] text-muted-foreground">NVDA / USD · Friday close → Monday open</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">
            $182<span className="text-base text-muted-foreground">.00</span>
            <span className="ml-3 align-middle text-sm font-medium text-up">+1.11% gap → YES</span>
          </p>
        </div>
        <span className="rounded-md border border-border bg-card-raised px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Illustration
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Illustration: NVDA closes Friday at $180, the feed is stale over the weekend, and the first Monday print at $182 is a 1.11% gap">
        <defs>
          <linearGradient id="gi-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#38CFF2" stopOpacity=".22" />
            <stop offset="1" stopColor="#38CFF2" stopOpacity="0" />
          </linearGradient>
          <pattern id="gi-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" stroke="#38CFF2" strokeOpacity=".07" strokeWidth="3" />
          </pattern>
        </defs>

        {/* session bands */}
        <rect x={X.close} y={Y0 - 34} width={X.open - X.close} height={Y1 - Y0 + 34} fill="url(#gi-hatch)" />
        <rect x={X.close} y={Y0 - 34} width={X.open - X.close} height={Y1 - Y0 + 34} fill="#38CFF2" fillOpacity=".05" />
        {[X.close, X.open].map((x) => (
          <line key={x} x1={x} x2={x} y1={Y0 - 34} y2={Y1} stroke="#38CFF2" strokeOpacity=".35" />
        ))}
        <text x={(X.fri + X.close) / 2} y={Y0 - 16} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px] uppercase tracking-wider">Cash open</text>
        <text x={(X.close + X.open) / 2} y={Y0 - 16} textAnchor="middle" className="fill-primary font-mono text-[10px] uppercase tracking-wider">Vespers · cash closed</text>
        <text x={(X.open + X.end) / 2} y={Y0 - 16} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px] uppercase tracking-wider">Cash open</text>

        {/* gridlines */}
        {[178, 180, 182].map((v) => (
          <line key={v} x1={X.fri} x2={X.end} y1={y(v)} y2={y(v)} stroke="currentColor" className="text-border" />
        ))}

        {/* Friday session */}
        <path d={`${friPath} L${X.close} ${Y1} L${X.fri} ${Y1} Z`} fill="url(#gi-area)" />
        <path d={friPath} fill="none" stroke="#38CFF2" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {/* stale weekend mark */}
        <line x1={X.close} x2={X.open} y1={y(180)} y2={y(180)} stroke="#38CFF2" strokeOpacity=".7" strokeWidth="2" strokeDasharray="2 6" strokeLinecap="round" />
        <text x={(X.close + X.open) / 2} y={y(180) + 18} textAnchor="middle" className="fill-muted-foreground font-mono text-[9.5px]">feed holds Friday&apos;s print (expected)</text>
        {/* Monday */}
        <path d={`${monPath} L${X.end} ${Y1} L${X.open + 8} ${Y1} Z`} fill="url(#gi-area)" />
        <path d={monPath} fill="none" stroke="#38CFF2" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {/* gap bracket */}
        <line x1={X.open - 6} x2={X.open - 6} y1={y(180)} y2={y(182)} stroke="currentColor" className="text-up" strokeWidth="1.5" />
        <line x1={X.open - 10} x2={X.open - 2} y1={y(182)} y2={y(182)} stroke="currentColor" className="text-up" strokeWidth="1.5" />
        <line x1={X.open - 10} x2={X.open - 2} y1={y(180)} y2={y(180)} stroke="currentColor" className="text-up" strokeWidth="1.5" />
        <text x={X.open - 16} y={(y(180) + y(182)) / 2 + 3} textAnchor="end" className="fill-foreground font-mono text-[10px] font-medium">+1.11%</text>

        {/* markers */}
        <circle cx={X.close} cy={y(180)} r="5" fill="#38CFF2" stroke="hsl(var(--card))" strokeWidth="2" />
        <circle cx={X.open + 8} cy={y(182)} r="5" fill="#38CFF2" stroke="hsl(var(--card))" strokeWidth="2" />
        <text x={X.close - 8} y={y(180) - 12} textAnchor="end" className="fill-foreground font-mono text-[10px] font-medium">Official close $180.00</text>
        <text x={X.end} y={y(182) - 16} textAnchor="end" className="fill-foreground font-mono text-[10px] font-medium">First print ≥ 09:30 · $182.00</text>

        {/* time axis */}
        {[
          [X.fri, "Fri 09:30", "start"],
          [X.close, "Fri 16:00", "middle"],
          [X.open, "Mon 09:30", "middle"],
          [X.end, "Mon 11:00", "end"],
        ].map(([x, t, a]) => (
          <text key={t as string} x={x as number} y={Y1 + 22} textAnchor={a as "start" | "middle" | "end"} className="fill-muted-foreground font-mono text-[10px]">{t}</text>
        ))}
        <text x={(X.close + X.open) / 2} y={Y1 + 22} textAnchor="middle" className="fill-muted-foreground/60 font-mono text-[10px]">≈ 65 h</text>
      </svg>
    </figure>
  );
}
