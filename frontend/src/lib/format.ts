import { formatUnits, hexToString, type Hex } from "viem";

const nf = (min: number, max: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: min, maximumFractionDigits: max });

/** USDG has 6 decimals. */
export function fmtUsdg(v: bigint | undefined, dp = 2): string {
  if (v === undefined) return "—";
  return nf(dp, Math.max(dp, 2)).format(Number(formatUnits(v, 6)));
}

/** Generic 18-dec value (vault shares, Stock Token raw, 1e18 USD marks). */
export function fmt18(v: bigint | undefined, dp = 4): string {
  if (v === undefined) return "—";
  return nf(0, dp).format(Number(formatUnits(v, 18)));
}

/** 18-dec USD price as $x.xx */
export function fmtUsd18(v: bigint | undefined): string {
  if (v === undefined) return "—";
  return "$" + nf(2, 2).format(Number(formatUnits(v, 18)));
}

export function fmtBps(bps: bigint | number | undefined): string {
  if (bps === undefined) return "—";
  return (Number(bps) / 100).toFixed(2) + "%";
}

const nyFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZoneName: "short",
});

/** Unix seconds → "Mon, Sep 28, 09:30 EDT" in America/New_York. */
export function fmtNy(ts: bigint | number | undefined): string {
  if (ts === undefined || Number(ts) === 0) return "—";
  return nyFmt.format(new Date(Number(ts) * 1000));
}

export function fmtCountdown(seconds: number): string {
  if (seconds <= 0) return "now";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

export function fmtAge(seconds: number): string {
  if (seconds < 0) return "future";
  if (seconds < 90) return `${Math.floor(seconds)}s ago`;
  if (seconds < 5400) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 172800) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function bytes32ToString(b: Hex | undefined): string {
  if (!b || /^0x0*$/.test(b)) return "";
  try {
    return hexToString(b, { size: 32 }).replace(/\u0000/g, "");
  } catch {
    return b;
  }
}

export function shortAddr(a?: string): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}
