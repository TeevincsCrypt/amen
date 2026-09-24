import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Providers } from "@/components/providers";
import { EligibilityStrip } from "@/components/eligibility";
import { themeScript } from "@/components/theme-toggle";

export const metadata: Metadata = {
  title: "Amen · the after-hours venue for Robinhood Stock Tokens",
  description:
    "Get paid to take the other side of overnight stocks. Gap markets on every listed Robinhood Stock Token, plus the Vespers Vault, on Robinhood Chain. Not for US persons.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is set before paint by themeScript (saved choice, else the device setting).
    <html lang="en" data-theme="dark" className={`dark ${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen font-sans">
        <Providers>
          <EligibilityStrip />
          {children}
        </Providers>
      </body>
    </html>
  );
}
