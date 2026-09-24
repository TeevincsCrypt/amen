import Link from "next/link";
import { Globe } from "lucide-react";

export const metadata = { title: "Not available in your region · Amen" };

export default function Unavailable() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-start justify-center gap-6 px-5 py-24">
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
        <Globe className="h-5 w-5 text-primary" />
      </span>
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Amen isn&apos;t available where you are.</h1>
        <p className="text-muted-foreground">
          Amen is not offered to US persons or in sanctioned jurisdictions. Robinhood Stock Tokens are debt securities that
          are not available to US persons, and Amen&apos;s markets are built on them.
        </p>
        <p className="text-sm text-muted-foreground">
          Eligibility depends on where you live, not only on your connection. Please don&apos;t try to work around this
          restriction.
        </p>
      </div>
      <div className="flex gap-3">
        <Link href="/" className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-sm hover:bg-muted">
          Back to the site
        </Link>
        <Link href="/risk" className="inline-flex h-10 items-center rounded-lg px-4 text-sm text-muted-foreground hover:text-foreground">
          Read the risks
        </Link>
      </div>
    </main>
  );
}
