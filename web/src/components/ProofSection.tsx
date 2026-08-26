import Link from "next/link";
import { TOOL_LABELS } from "@/lib/activity";

/**
 * Static, hardcoded example cards - deliberately NOT a live GET /activity
 * query. This section used to fetch each provider's most recent settled
 * negotiation server-side; on a fresh/empty production database (a brand
 * new Railway Postgres instance has zero rows until real traffic happens)
 * that meant every card fell back to "No settled negotiations yet", which
 * is a bad first impression for a page whose whole job is to look
 * trustworthy. These three cards always render, regardless of what's
 * actually in the database - real negotiation history is what the
 * dashboard's own live tables (ActivityTable, per-tool breakdown, etc.)
 * are for.
 *
 * Values are clearly representative, not tied to any specific real
 * transaction - negotiationId deliberately uses an obviously-placeholder
 * pattern (not a real UUID shape you might mistake for something you could
 * look up) rather than looking like an unverifiable real settlement.
 * agreedPrice values match this project's own real, documented preset
 * examples (see NegotiationSection.tsx's PRESETS) rather than being
 * invented numbers.
 */
interface ExampleDeal {
  providerName: string;
  tool: string;
  agreedPrice: number;
  negotiationIdLabel: string;
  minutesAgo: number;
}

const EXAMPLE_DEALS: ExampleDeal[] = [
  {
    providerName: "BTC Cycle Intelligence",
    tool: "get_btc_cycle_regime",
    agreedPrice: 0.006,
    negotiationIdLabel: "example-01",
    minutesAgo: 47,
  },
  {
    providerName: "Short Squeeze Intelligence",
    tool: "get_squeeze_risk",
    agreedPrice: 0.008,
    negotiationIdLabel: "example-02",
    minutesAgo: 165,
  },
  {
    providerName: "Analyst Momentum",
    tool: "get_analyst_momentum",
    agreedPrice: 0.07,
    negotiationIdLabel: "example-03",
    minutesAgo: 22 * 60,
  },
];

function ExampleCard({ deal }: { deal: ExampleDeal }) {
  const timestamp = new Date(Date.now() - deal.minutesAgo * 60_000);

  return (
    <div className="w-full min-w-0 rounded-2xl border border-[rgba(139,124,246,0.28)] bg-surface-gradient p-6 text-left shadow-glow">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success/20 text-success">
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M4 10.5l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="min-w-0 truncate text-xs font-semibold tracking-wide text-ink-label">
          Deal Completed
        </span>
      </div>

      <h3 className="mt-4 min-w-0 truncate font-display text-lg font-bold text-ink-heading">
        {TOOL_LABELS[deal.tool] ?? deal.tool}
      </h3>
      <p className="mt-1 min-w-0 truncate text-xs text-ink-label">
        Provider: {deal.providerName}
      </p>

      <p className="mt-4 min-w-0 break-words font-display text-3xl font-bold text-ink-heading">
        ${deal.agreedPrice} <span className="text-base font-medium text-ink-body">USDC</span>
      </p>

      <div className="mt-6 flex min-w-0 items-center gap-2 border-t border-subtle pt-4">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-success opacity-70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
        </span>
        <span className="min-w-0 truncate text-xs font-bold uppercase tracking-wide text-success">
          Intelligence Delivered
        </span>
      </div>

      <p className="mt-3 min-w-0 truncate text-[11px] text-ink-label">
        Example negotiation {deal.negotiationIdLabel} · {timestamp.toLocaleString()}
      </p>
    </div>
  );
}

export default function ProofSection() {
  return (
    <section className="relative w-full overflow-hidden border-t border-subtle px-4 py-12 sm:px-6 sm:py-14 lg:px-8 lg:py-16">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center text-center">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-label">
          How it works
        </span>
        <h2 className="mt-4 w-full text-balance break-words font-display text-2xl font-bold text-ink-heading sm:text-3xl">
          What a settled negotiation looks like.
        </h2>
        <p className="mt-3 w-full max-w-xl text-balance break-words text-sm leading-relaxed text-ink-body sm:text-base">
          Representative examples, one per provider - not live data pulled
          from <code>GET /activity</code>. For real negotiation history, see
          the{" "}
          <Link href="/dashboard" className="text-accent-light underline underline-offset-2 transition-colors hover:text-ink-heading">
            Dashboard
          </Link>
          ; real Base settlements are independently verifiable on-chain.
        </p>
      </div>

      {/* Own (wider) width from the heading text above - a fixed grid-cols-2
          here would cap out at 2 providers forever. sm:grid-cols-2 keeps two
          per row on tablet regardless of count; lg:grid-cols-3 spreads out
          to one row once there's room, and gracefully wraps to a 2nd row
          for a 4th+ provider rather than assuming an exact count. */}
      <div className="mx-auto mt-10 grid w-full max-w-5xl min-w-0 grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {EXAMPLE_DEALS.map((deal) => (
          <ExampleCard key={deal.providerName} deal={deal} />
        ))}
      </div>
    </section>
  );
}
