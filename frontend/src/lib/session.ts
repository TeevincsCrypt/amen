// Client-side NYSE regular-hours calendar for chart shading (holidays are not shaded).
const nyFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", hour12: false });

function nyParts(sec: number) {
  const p = nyFmt.formatToParts(new Date(sec * 1000));
  const hour = Number(p.find((x) => x.type === "hour")?.value ?? 0) % 24;
  const weekday = p.find((x) => x.type === "weekday")?.value ?? "";
  return { hour, weekday };
}

/** Regular cash sessions (09:30–16:00 America/New_York, Mon–Fri) intersecting [t0, t1], in unix seconds. */
export function cashSessions(t0: number, t1: number): [number, number][] {
  const out: [number, number][] = [];
  for (let day = Math.floor(t0 / 86400) - 1; day * 86400 <= t1; day++) {
    const noon = day * 86400 + 12 * 3600;
    const { hour, weekday } = nyParts(noon);
    if (weekday === "Sat" || weekday === "Sun") continue;
    const offset = (12 - hour + 24) % 24; // 4 (EDT) or 5 (EST)
    const open = day * 86400 + (9.5 + offset) * 3600;
    const close = day * 86400 + (16 + offset) * 3600;
    if (close > t0 && open < t1) out.push([Math.max(open, t0), Math.min(close, t1)]);
  }
  return out;
}

export function isCashAt(t: number): boolean {
  return cashSessions(t - 1, t + 1).some(([a, b]) => t >= a && t < b);
}
