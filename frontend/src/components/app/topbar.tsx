"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@/components/connect-button";
import { SessionChip } from "@/components/session-chip";
import { Logo } from "@/components/logo";
import { APP_NAV } from "./sidebar";
import { useChainNow, useSession } from "@/lib/hooks";
import { fmtAge, fmtUsd18 } from "@/lib/format";
import { activeChain, isLocal } from "@/lib/chains";
import { cn } from "@/lib/utils";

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-7 shrink-0 items-center gap-2 rounded-lg border border-border bg-card-raised px-2.5 text-xs text-muted-foreground", className)}>
      {children}
    </span>
  );
}

export function Topbar() {
  const path = usePathname();
  const s = useSession();
  const now = useChainNow();
  const age = s.markUpdatedAt && now ? now - Number(s.markUpdatedAt) : undefined;
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="flex h-14 items-center gap-3 px-4 md:px-6">
        <Link href="/" className="md:hidden" aria-label="Amen home">
          <Logo size={26} wordmark={false} />
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [scrollbar-width:none]">
          <Chip>
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            {isLocal ? "Demo chain" : activeChain.name}
            <span className="font-mono text-[10.5px] opacity-70">{activeChain.id}</span>
          </Chip>
          <Chip>
            NVDA/USD <span className="font-mono text-foreground">{fmtUsd18(s.markPrice)}</span>
          </Chip>
          <Chip className="hidden sm:inline-flex">
            Feed <span className="font-mono text-foreground">{age !== undefined ? fmtAge(age) : "—"}</span>
          </Chip>
          <SessionChip />
        </div>
        <ConnectButton />
      </div>
      <nav className="flex gap-1 overflow-x-auto border-t border-border px-3 py-2 text-sm md:hidden">
        {APP_NAV.map((l) => (
          <Link key={l.href} href={l.href} className={cn("shrink-0 rounded-md px-3 py-1.5 text-muted-foreground", path === l.href && "bg-muted text-foreground")}>
            {l.label}
          </Link>
        ))}
        <Link href="/risk" className="shrink-0 rounded-md px-3 py-1.5 text-muted-foreground">
          Risk
        </Link>
      </nav>
    </header>
  );
}
