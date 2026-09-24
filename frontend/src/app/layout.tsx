import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Providers } from "@/components/providers";
import { EligibilityStrip } from "@/components/eligibility";

export const metadata: Metadata = {
  title: "Amen · the after-hours venue for Robinhood Stock Tokens",
  description:
    "Get paid to take the other side of overnight stocks. Gap markets on every listed Robinhood Stock Token, plus the Vespers Vault, on Robinhood Chain. Not for US persons.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen font-sans">
        <Providers>
          <EligibilityStrip />
          {children}
        </Providers>
      </body>
    </html>
  );
}
