import Link from "next/link";
import { Logo } from "@/components/logo";

export const REPO_URL = "https://github.com/TeevincsCrypt/amen";

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="space-y-4">
          <Logo size={28} />
          <p className="max-w-sm text-sm text-muted-foreground">The after-hours venue for Robinhood Stock Tokens.</p>
        </div>
        <div className="space-y-3 text-sm">
          <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Protocol</p>
          <Link href="/app" className="block text-muted-foreground hover:text-foreground">App</Link>
          <Link href="/app/vault" className="block text-muted-foreground hover:text-foreground">Vespers Vault</Link>
          <Link href="/app/markets" className="block text-muted-foreground hover:text-foreground">Amen Market</Link>
        </div>
        <div className="space-y-3 text-sm">
          <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Learn</p>
          <Link href="/risk" className="block text-muted-foreground hover:text-foreground">Risk</Link>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="block text-muted-foreground hover:text-foreground">GitHub</a>
        </div>
      </div>
      <div className="border-t border-border">
        <p className="mx-auto max-w-6xl px-5 py-6 text-xs leading-relaxed text-muted-foreground">
          Not for US persons. Robinhood Stock Tokens are debt securities issued by Robinhood Assets (Jersey) Limited. They
          give economic exposure only and are not shares. Amen is unaudited software, not a broker, and nothing here is
          investment advice.
        </p>
      </div>
    </footer>
  );
}
