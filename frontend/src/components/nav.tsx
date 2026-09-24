"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "./connect-button";
import { SessionChip } from "./session-chip";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Amen" },
  { href: "/vault", label: "Vespers" },
  { href: "/markets", label: "Market" },
  { href: "/risk", label: "Risk" },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
        <div className="flex items-center gap-8">
          <Link href="/" className="font-serif text-xl tracking-wide">
            Amen<span className="text-gilt">.</span>
          </Link>
          <nav className="flex gap-5 text-sm">
            {LINKS.slice(1).map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={cn("text-muted-foreground transition-colors hover:text-foreground", path === l.href && "text-foreground")}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <SessionChip />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
