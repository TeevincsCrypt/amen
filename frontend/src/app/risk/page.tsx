const SECTIONS: { h: string; p: string[] }[] = [
  {
    h: "What a Stock Token is",
    p: [
      "Robinhood Stock Tokens are ERC-20 debt securities issued by Robinhood Assets (Jersey) Limited. They give economic exposure to a listed share. They do not make you a shareholder, and they carry no voting rights.",
      "Corporate actions such as splits and distributions are reflected through a UI multiplier (ERC-8056), not by rebasing balances. Your raw token balance is not a share count. Amen shows both the raw balance and the share-equivalent (raw × uiMultiplier).",
      "Only Authorized Participants mint or burn Stock Tokens. Amen never does.",
    ],
  },
  {
    h: "Who can use Amen",
    p: [
      "Amen is not available to US persons. There is no US onboarding and no fiat on-ramp. Amen is software. It is not a broker and gives no investment advice.",
    ],
  },
  {
    h: "Oracle risk",
    p: [
      "Prices come from Chainlink Stock Token feeds on Robinhood Chain. Those feeds already account for corporate actions, so Amen never multiplies the price by the UI multiplier.",
      "A token can report oraclePaused(). When it does, Amen freezes: no vault swaps, no new market positions and no resolution.",
      "A price of zero or less, or a feed call that fails, also freezes Amen.",
      "While US cash is open, a feed older than 30 minutes freezes Amen.",
    ],
  },
  {
    h: "Weekend and overnight marks can be stale",
    p: [
      "Equity feeds update roughly 24/5 with US market hours. Over a weekend the last price can be days old. That is expected, so Amen doesn't freeze just because it's Saturday.",
      "A stale mark is never used to settle a market. Settlement needs the first Chainlink print during the cash session at or after the market's resolve time.",
      "Because the weekend mark can be stale, the Vespers vault locks deposits and withdrawals while it holds NVDA during closed hours. Otherwise one LP could trade against another at a price everyone knows is old. You can exit in USDG after the next flatten.",
    ],
  },
  {
    h: "Vespers Vault risks",
    p: [
      "The vault may hold up to 50% of its NAV in NVDA while cash is closed. If NVDA gaps against that inventory at the open, LPs lose money. That is the risk LPs are paid to take.",
      "Inventory is moved by a keeper through a swap venue, within 0.5% (50 bps) of the oracle mark. A 10% performance fee is charged on positive realized cycle PnL. There is no management fee in Phase 1.",
      "If the oracle is frozen while the vault holds NVDA, or during a cash-open freeze, deposits and withdrawals lock until the mark is healthy.",
    ],
  },
  {
    h: "Amen Market rules and void rules",
    p: [
      "Markets are parimutuel. Winners split the whole pool minus a 1% taker fee, in proportion to their stake. You can lose your whole stake. There is no leverage.",
      "A market settles on one specific round: the first Chainlink print during the cash session at or after the resolve time. Pre-market prints are ignored, and so are later prints.",
      "If the market isn't resolved within 60 minutes of its resolve time (stale feed, paused oracle, holiday, or nobody calls resolve), anyone can void it. Everyone is then refunded 1:1 and no fee is charged.",
      "If one side has no stake at resolution, the market voids and refunds too.",
      "Holidays are set by the protocol owner or a keeper. A missed holiday leads to a void, never a wrong settlement. Half-day sessions are not modelled in Phase 1.",
    ],
  },
  {
    h: "Smart contract and operational risk",
    p: [
      "Amen's contracts are an unaudited MVP. There are no upgradeable proxies. The owner can freeze the protocol, set holidays, register feeds and change fees within hard caps. The owner cannot type a price: official closes are always read from Chainlink.",
      "USDG is issued by Paxos and can be frozen by its issuer. A frozen address can't receive payouts.",
    ],
  },
];

export default function RiskPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-10">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.3em] text-destructive">Risk, in plain language</p>
        <h1 className="font-serif text-4xl">Read this before you say amen.</h1>
        <p className="text-muted-foreground">Not for US persons. Not investment advice. Stock Tokens are debt securities and give no share ownership.</p>
      </header>
      {SECTIONS.map((s) => (
        <section key={s.h} className="space-y-3 border-t border-border pt-6">
          <h2 className="font-serif text-2xl">{s.h}</h2>
          {s.p.map((p, i) => (
            <p key={i} className="leading-relaxed text-muted-foreground">
              {p}
            </p>
          ))}
        </section>
      ))}
    </article>
  );
}
