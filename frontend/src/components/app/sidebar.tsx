"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, BookOpen, Github, Layers, LayoutDashboard, ShieldAlert, Vault } from "lucide-react";
import { Logo } from "@/components/logo";
import { activeChain, isLocal } from "@/lib/chains";
import { useChainOnline } from "@/components/chain-status";
import { cn } from "@/lib/utils";

export const APP_NAV = [
  { href: "/app", label: "Overview", icon: LayoutDashboard },
  { href: "/app/vault", label: "Vespers Vault", icon: Vault },
  { href: "/app/markets", label: "Amen Market", icon: Layers },
];

const LEARN = [
  { href: "/risk", label: "Risk", icon: ShieldAlert, external: false },
  { href: "/#how", label: "How it works", icon: BookOpen, external: false },
  { href: "https://github.com/TeevincsCrypt/amen", label: "GitHub", icon: Github, external: true },
];

export function Sidebar() {
  const path = usePathname();
  const online = useChainOnline();
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-card/60 md:flex">
      <div className="px-5 py-5">
        <Link href="/" aria-label="Amen home">
          <Logo size={30} sub="After-hours venue" />
        </Link>
      </div>
      <nav className="flex-1 space-y-6 px-3 py-2 text-sm">
        <div className="space-y-0.5">
          <p className="px-3 pb-2 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground/70">Protocol</p>
          {APP_NAV.map((l) => {
            const active = path === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  active && "bg-muted text-foreground",
                )}
              >
                <l.icon className={cn("h-4 w-4", active && "text-primary")} />
                {l.label}
              </Link>
            );
          })}
        </div>
        <div className="space-y-0.5">
          <p className="px-3 pb-2 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground/70">Learn</p>
          {LEARN.map((l) =>
            l.external ? (
              <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <l.icon className="h-4 w-4" />
                {l.label}
              </a>
            ) : (
              <Link key={l.href} href={l.href} className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <l.icon className="h-4 w-4" />
                {l.label}
              </Link>
            ),
          )}
        </div>
      </nav>
      <div className="space-y-3 p-3">
        <div className="rounded-lg border border-border bg-card-raised p-3">
          <div className="flex items-center gap-2 text-xs">
            <span className={cn("h-1.5 w-1.5 rounded-full", online ? "bg-up" : "bg-destructive")} />
            <span className="font-medium">{isLocal ? "Demo chain" : activeChain.name}</span>
          </div>
          <p className="mt-1 font-mono text-[10.5px] text-muted-foreground">
            chain {activeChain.id}
            {isLocal && " · mocks only"}
          </p>
        </div>
        <Link href="/" className="flex items-center gap-2 px-3 py-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to site
        </Link>
      </div>
    </aside>
  );
}
