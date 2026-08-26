const STEPS = [
  {
    number: "01",
    title: "Propose",
    description:
      "Your agent sends a proposed price for a data tool — BTC cycle regime, entry risk, LTH behavior  to Metron's /quote endpoint.",
  },
  {
    number: "02",
    title: "Negotiate",
    description:
      "The seller accepts outright, counters at its cost floor with a reason, or rejects, bounded to a handful of rounds per session.",
  },
  {
    number: "03",
    title: "Settle",
    description:
      "Once a price is agreed, payment settles via x402 on Base mainnet through Coinbase's hosted facilitator, no invoices, no manual reconciliation.",
  },
  {
    number: "04",
    title: "Deliver",
    description:
      "The seller calls the live intelligence tool and returns the data, with delivery guaranteed once payment has landed. Responses are returned as machine-readable data, ready for downstream agent use.",
  },
];

export default function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="relative w-full overflow-hidden border-t border-subtle px-4 py-12 sm:px-6 sm:py-14 lg:px-8 lg:py-16"
    >
      <div className="mx-auto w-full max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-label">
            How the engine works
          </span>
          <h2 className="mt-4 w-full text-balance break-words font-display text-3xl font-bold text-ink-heading sm:text-4xl">
            Four steps from proposal to settled data.
          </h2>
        </div>

        {/* Mobile / tablet: vertical timeline */}
        <div className="mt-14 flex flex-col lg:hidden">
          {STEPS.map((step, i) => (
            <div key={step.number} className="flex w-full gap-4">
              <div className="flex flex-shrink-0 flex-col items-center">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-strong bg-canvas font-display text-base font-bold text-ink-heading">
                  {step.number}
                </div>
                {i !== STEPS.length - 1 && (
                  <div aria-hidden className="w-px flex-1 bg-accent/30" />
                )}
              </div>
              <div className="min-w-0 pb-10">
                <h3 className="font-display text-lg font-semibold text-ink-heading">
                  {step.title}
                </h3>
                <p className="mt-2 break-words text-sm leading-relaxed text-ink-body">
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop: horizontal row with connecting line */}
        <div className="relative mt-20 hidden lg:flex lg:flex-row lg:gap-6">
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 right-0 top-6 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent"
          />
          {STEPS.map((step) => (
            <div
              key={step.number}
              className="relative z-10 flex min-w-0 flex-1 flex-col items-center gap-5 text-center"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-strong bg-canvas font-display text-base font-bold text-ink-heading">
                {step.number}
              </div>
              <div className="min-w-0 px-2">
                <h3 className="font-display text-lg font-semibold text-ink-heading">
                  {step.title}
                </h3>
                <p className="mt-2 break-words text-sm leading-relaxed text-ink-body">
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
