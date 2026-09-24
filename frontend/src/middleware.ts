import { NextResponse, type NextRequest } from "next/server";

/**
 * Region gate for the app on mainnet builds (or when GEOBLOCK=on).
 * Stock Tokens aren't available to US persons, and Amen doesn't serve sanctioned jurisdictions.
 * IP geolocation is a best-effort control, not a guarantee; eligibility is also attested in-app.
 * Add jurisdictions after legal review with GEOBLOCK_EXTRA="DE,FR,..." (ISO 3166-1 alpha-2).
 */
const BLOCKED = new Set([
  // United States and territories
  "US", "PR", "GU", "VI", "AS", "MP", "UM",
  // Comprehensively sanctioned
  "CU", "IR", "KP", "SY",
]);
// Occupied regions of Ukraine (ISO 3166-2 subdivision codes as sent by Vercel).
const BLOCKED_UA_REGIONS = new Set(["43", "40", "14", "09"]);

export function middleware(req: NextRequest) {
  const enabled = process.env.NEXT_PUBLIC_AMEN_CHAIN === "mainnet" || process.env.GEOBLOCK === "on";
  if (!enabled) return NextResponse.next();

  const country = (req.geo?.country || req.headers.get("x-vercel-ip-country") || "").toUpperCase();
  const region = (req.geo?.region || req.headers.get("x-vercel-ip-country-region") || "").toUpperCase();
  const extra = (process.env.GEOBLOCK_EXTRA || "").toUpperCase().split(",").map((s) => s.trim()).filter(Boolean);

  const blocked = BLOCKED.has(country) || extra.includes(country) || (country === "UA" && BLOCKED_UA_REGIONS.has(region));
  if (!blocked) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/unavailable";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/app", "/app/:path*"] };
