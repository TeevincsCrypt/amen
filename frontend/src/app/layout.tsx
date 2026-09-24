import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Nav } from "@/components/nav";
import { EligibilityGate, EligibilityStrip } from "@/components/eligibility";
import { FreezeBanner } from "@/components/freeze-banner";
import { ChainStatus } from "@/components/chain-status";

export const metadata: Metadata = {
  title: "Amen — the after-hours venue for Robinhood Stock Tokens",
  description: "Vespers Vault and Amen Market on Robinhood Chain. Not for US persons.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen font-sans">
        <Providers>
          <EligibilityStrip />
          <ChainStatus />
          <FreezeBanner />
          <Nav />
          <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
          <footer className="mx-auto max-w-6xl px-6 pb-10 pt-6 text-[11px] text-muted-foreground">
            Amen Protocol · Robinhood Chain · Not for US persons · Not advice · Stock Tokens are debt securities and give no
            share ownership.
          </footer>
          <EligibilityGate />
        </Providers>
      </body>
    </html>
  );
}
