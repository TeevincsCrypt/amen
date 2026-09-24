"use client";

import Link from "next/link";
import { SessionChip } from "@/components/session-chip";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Stat } from "@/components/stat";
import { useChainNow, useSession } from "@/lib/hooks";
import { fmtAge, fmtNy, fmtUsd18 } from "@/lib/format";
import { activeChain } from "@/lib/chains";
import { deployment } from "@/lib/contracts";
import { NoDeployment } from "@/components/no-deployment";

export default function Home() {
  const s = useSession();
  const now = useChainNow();
  const age = s.markUpdatedAt && now ? now - Number(s.markUpdatedAt) : undefined;

  return (
    <div className="space-y-16">
      <section className="grid gap-12 md:grid-cols-[1.3fr_1fr] md:items-end">
        <div className="space-y-6">
          <p className="text-xs uppercase tracking-[0.3em] text-gilt">Amen Protocol · Robinhood Chain</p>
          <h1 className="font-serif text-5xl leading-[1.05] sm:text-6xl">
            Get paid to take the other side of overnight NVDA.
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground">
            Amen is the after-hours venue for official Robinhood Stock Tokens. When the US cash market closes, Stock
            Tokens keep moving. Amen is where that risk meets a counterparty.
          </p>
          <p className="max-w-xl font-serif text-sm italic text-muted-foreground">
            <em>Amen</em> is the window after the cash close: the market&apos;s last word for that session.
          </p>
          <div className="flex gap-3">
            <Link href="/vault">
              <Button>Enter Vespers</Button>
            </Link>
            <Link href="/markets">
              <Button variant="outline">Amen Market</Button>
            </Link>
          </div>
        </div>
        <Card className="p-6">
          <p className="mb-4 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">US cash session · NVDA</p>
          {deployment ? <SessionChip large /> : <NoDeployment />}
          {deployment && (
            <div className="mt-6 grid grid-cols-2 gap-4 border-t border-border pt-5">
              <Stat label="NVDA/USD mark" value={fmtUsd18(s.markPrice)} unit="Chainlink, normalized to 18 dec (USD)" />
              <Stat
                label="Feed updated"
                value={age !== undefined ? fmtAge(age) : "—"}
                unit={s.markUpdatedAt ? fmtNy(s.markUpdatedAt) : undefined}
                hint={!s.cashOpen ? "A stale feed is normal while cash is closed" : undefined}
              />
            </div>
          )}
        </Card>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <p className="text-[11px] uppercase tracking-[0.2em] text-vespers">I · Vespers Vault</p>
            <CardTitle>Inventory only while cash is closed</CardTitle>
            <CardDescription>
              LPs deposit USDG. During Vespers the vault may hold up to 50% NVDA inventory against USDG, then it flattens
              back to USDG at the open. LPs earn the closed-market spread, minus a 10% performance fee on realized cycle
              profit. There is no token, no points, and no lock-up beyond the next flatten.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <p className="text-[11px] uppercase tracking-[0.2em] text-cash">II · Amen Market</p>
            <CardTitle>Defined-risk gap books</CardTitle>
            <CardDescription>
              Parimutuel YES/NO books on the NVDA weekend or overnight gap, collateralized in USDG. Settlement uses the
              first Chainlink print after the open, and a hard freeze applies if that print doesn&apos;t arrive. If a
              market can&apos;t resolve cleanly, it voids and every stake is refunded.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Your maximum loss is your stake. There is no leverage.
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 border-t border-border pt-10 text-sm text-muted-foreground md:grid-cols-3">
        <div>
          <h4 className="mb-2 font-serif text-base text-foreground">Why Robinhood Chain</h4>
          Official Stock Tokens, Chainlink Stock Token feeds and a USDG settlement asset all live here natively. The FCFS
          sequencer means no priority-gas auctions around the open.
        </div>
        <div>
          <h4 className="mb-2 font-serif text-base text-foreground">What you hold</h4>
          Stock Tokens are debt securities that track a share with total-return accounting (ERC-8056 UI multiplier). They are
          not the share itself.
        </div>
        <div>
          <h4 className="mb-2 font-serif text-base text-foreground">Network</h4>
          {activeChain.name} · chain id <span className="font-mono">{activeChain.id}</span>
        </div>
      </section>
    </div>
  );
}
