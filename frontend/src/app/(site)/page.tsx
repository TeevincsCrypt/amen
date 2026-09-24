import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Ban,
  Clock,
  Globe,
  KeyRound,
  Layers,
  Moon,
  Scale,
  Snowflake,
  Sun,
  Undo2,
  Vault,
} from "lucide-react";
import { GapIllustration } from "@/components/site/gap-illustration";
import { SplitBar } from "@/components/split-bar";
import { REPO_URL } from "@/components/site/site-footer";

const FACTS = [
  { value: "≤ 50%", label: "of vault NAV in NVDA, added only while US cash is closed" },
  { value: "50 bps", label: "max distance between a keeper swap and the oracle mark" },
  { value: "60 min", label: "to settle after the open, or every stake is refunded 1:1" },
  { value: "1%", label: "taker fee, charged only when a market actually resolves" },
];

const STEPS = [
  {
    time: "16:00 ET",
    icon: Sun,
    title: "The close is recorded",
    body: "Anyone records the last Chainlink round before the New York bell. After-hours prints are rejected, and nobody can type a price.",
  },
  {
    time: "Vespers",
    icon: Moon,
    title: "Cash is closed, NVDA isn't",
    body: "The vault may carry NVDA inventory against USDG. Traders take YES or NO on the size of the gap, collateralized in USDG.",
  },
  {
    time: "09:30 ET",
    icon: Scale,
    title: "The first print settles",
    body: "Markets settle on the first cash-session print at or after the open, proven by round id. The vault flattens and books the cycle's PnL.",
  },
];

const SAFETY = [
  { icon: Snowflake, title: "Oracle pause freezes everything", body: "If NVDA reports oraclePaused(), swaps, new positions and resolution stop. Balances are untouched." },
  { icon: Clock, title: "Stale at the open means frozen", body: "A feed older than 30 minutes during cash hours freezes the mark. A stale weekend feed is expected, and never settles anything." },
  { icon: KeyRound, title: "No round shopping", body: "Settlement uses one specific round: the first cash-session print at or after the resolve time. Who calls, and when, doesn't matter." },
  { icon: Undo2, title: "Refund over a guess", body: "No valid resolve within 60 minutes, or nobody on one side, and every stake is refunded 1:1 with no fee." },
  { icon: Ban, title: "Nobody types a price", body: "Official closes are always Chainlink rounds, even when the owner forces one. The owner can freeze, never set a price." },
  { icon: Globe, title: "Not for US persons", body: "Stock Tokens are debt securities issued by Robinhood Assets (Jersey) Limited. They give economic exposure and are not shares." },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">{children}</p>;
}

export default function Landing() {
  return (
    <main>
      {/* ── hero ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_30%,black,transparent)]" />
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(56,207,242,0.18),transparent)]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-16 md:pt-24 lg:grid-cols-[1.05fr_1fr]">
          <div className="space-y-7">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-primary" />
              Built for Robinhood Chain · official NVDA Stock Tokens
            </span>
            <h1 className="text-[2.6rem] font-semibold leading-[1.04] tracking-tight sm:text-6xl">
              Get paid to take the other side of <span className="text-brand-gradient">overnight NVDA.</span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
              When US cash closes, NVDA Stock Tokens keep trading on-chain. Amen gives that risk a counterparty: a USDG
              vault that carries it, and gap markets that price it.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/app"
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Launch app <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/#how"
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-border bg-card/60 px-5 font-medium transition-colors hover:bg-muted"
              >
                How it works
              </Link>
            </div>
            <p className="font-mono text-xs text-muted-foreground">USDG settlement · Chainlink marks · freeze-first by design</p>
          </div>
          <GapIllustration />
        </div>
      </section>

      {/* ── facts ────────────────────────────────────────── */}
      <section className="border-y border-border bg-card/40">
        <div className="mx-auto grid max-w-6xl grid-cols-2 divide-border md:grid-cols-4 md:divide-x">
          {FACTS.map((f) => (
            <div key={f.value} className="px-5 py-7">
              <p className="text-3xl font-semibold tracking-tight">{f.value}</p>
              <p className="mt-2 text-sm leading-snug text-muted-foreground">{f.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── how it works ─────────────────────────────────── */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-24">
        <div className="max-w-2xl space-y-4">
          <SectionLabel>How it works</SectionLabel>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">From the bell to the open.</h2>
          <p className="text-muted-foreground">
            <em className="not-italic text-foreground">Amen</em> is the window after the cash close: the market&apos;s last
            word for the session. Everything Amen does happens between those two moments.
          </p>
        </div>
        <ol className="mt-12 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative rounded-xl border border-border bg-card p-6">
              <div className="flex items-center justify-between">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card-raised">
                  <s.icon className="h-4 w-4 text-primary" />
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {String(i + 1).padStart(2, "0")} · {s.time}
                </span>
              </div>
              <h3 className="mt-6 text-lg font-medium">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── products ─────────────────────────────────────── */}
      <section id="products" className="mx-auto max-w-6xl scroll-mt-20 px-5 pb-24">
        <div className="max-w-2xl space-y-4">
          <SectionLabel>Products</SectionLabel>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Two ways to take the overnight side.</h2>
        </div>
        <div className="mt-12 grid gap-4 lg:grid-cols-2">
          <article className="flex flex-col rounded-xl border border-border bg-card p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <Vault className="h-4 w-4 text-primary" />
              </span>
              <div>
                <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">For liquidity providers</p>
                <h3 className="text-xl font-semibold">Vespers Vault</h3>
              </div>
            </div>
            <p className="mt-5 text-muted-foreground">Deposit USDG. The vault carries NVDA only while cash is closed and earns the closed-market spread.</p>
            <ul className="mt-5 space-y-2.5 text-sm">
              {[
                "Inventory only during Vespers, capped at 50% of NAV",
                "Keeper swaps must land within 50 bps of the oracle mark",
                "Entry and exit pause while NVDA is held over a stale weekend mark",
                "10% performance fee on realized cycle profit. No token, no lock-up",
              ].map((t) => (
                <li key={t} className="flex gap-2.5">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" />
                  <span className="text-foreground/90">{t}</span>
                </li>
              ))}
            </ul>
            <div className="mt-auto pt-8">
              <div className="rounded-lg border border-border bg-card-raised p-4 pt-6">
                <SplitBar
                  marker={{ at: 50, label: "50% cap" }}
                  segments={[
                    { label: "USDG", value: 60, display: "60.00 USDG", color: "s1" },
                    { label: "NVDA", value: 40, display: "40.00 USDG of NVDA", color: "s2" },
                  ]}
                />
                <p className="mt-3 font-mono text-[10px] text-muted-foreground">Demo cycle · NAV 100.00 USDG · realized PnL +0.44 USDG</p>
              </div>
            </div>
          </article>

          <article className="flex flex-col rounded-xl border border-border bg-card p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <Layers className="h-4 w-4 text-primary" />
              </span>
              <div>
                <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">For traders</p>
                <h3 className="text-xl font-semibold">Amen Market</h3>
              </div>
            </div>
            <p className="mt-5 text-muted-foreground">Defined-risk books on the overnight gap. Will NVDA open at least 1% away from Friday&apos;s close?</p>
            <ul className="mt-5 space-y-2.5 text-sm">
              {[
                "Take YES or NO in USDG. Your max loss is your stake",
                "Parimutuel: winners split the whole pool, minus a 1% fee",
                "Settled by the first cash-session Chainlink print after the open",
                "No clean print within 60 minutes, and every stake is refunded",
              ].map((t) => (
                <li key={t} className="flex gap-2.5">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" />
                  <span className="text-foreground/90">{t}</span>
                </li>
              ))}
            </ul>
            <div className="mt-auto pt-8">
              <div className="rounded-lg border border-border bg-card-raised p-4">
                <SplitBar
                  segments={[
                    { label: "YES pool", value: 100, display: "100.00 USDG · pays 3.96×", color: "s1" },
                    { label: "NO pool", value: 300, display: "300.00 USDG · pays 1.32×", color: "s2" },
                  ]}
                />
                <p className="mt-3 font-mono text-[10px] text-muted-foreground">Demo market · gap ≥ 1.00% · resolved YES at $182.00</p>
              </div>
            </div>
          </article>
        </div>
      </section>

      {/* ── safety ───────────────────────────────────────── */}
      <section id="safety" className="scroll-mt-20 border-y border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-5 py-24">
          <div className="max-w-2xl space-y-4">
            <SectionLabel>Safety</SectionLabel>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Built to freeze, not to guess.</h2>
            <p className="text-muted-foreground">When the data is doubtful, Amen stops and refunds. It never settles on a price it can&apos;t prove.</p>
          </div>
          <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {SAFETY.map((s) => (
              <div key={s.title} className="bg-card p-6">
                <s.icon className="h-5 w-5 text-primary" />
                <h3 className="mt-4 font-medium">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── why robinhood chain ──────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 py-24">
        <div className="max-w-2xl space-y-4">
          <SectionLabel>Why Robinhood Chain</SectionLabel>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Only possible here.</h2>
        </div>
        <div className="mt-12 grid gap-10 md:grid-cols-3">
          {[
            ["Tokens trade 24/7", "Official NVDA Stock Tokens transfer and swap on nights and weekends, while the US cash market sleeps."],
            ["Feeds run 24/5", "Chainlink Stock Token feeds follow market hours, so the weekend mark is stale by design. Amen is built around that gap."],
            ["Native settlement", "USDG as the dollar, ERC-8056 corporate actions already priced into the feed, and a first-come sequencer with no gas auction at the open."],
          ].map(([t, b]) => (
            <div key={t} className="border-l border-border pl-5">
              <h3 className="font-medium">{t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 pb-24">
        <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-card p-8 sm:p-12">
          <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(closest-side,rgba(56,207,242,0.22),transparent)]" />
          <div className="pointer-events-none absolute -bottom-24 left-10 h-64 w-64 rounded-full bg-[radial-gradient(closest-side,rgba(42,111,217,0.25),transparent)]" />
          <div className="relative flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
            <div className="max-w-xl space-y-3">
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Friday close to Monday open, in twelve clicks.</h2>
              <p className="text-muted-foreground">
                The live demo runs on a public test chain with mock NVDA and USDG. No wallet, no real funds.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/app"
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Launch the demo <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-border px-5 font-medium transition-colors hover:bg-muted"
              >
                View the code <ArrowUpRight className="h-4 w-4" />
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
