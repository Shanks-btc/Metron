export default function Hero() {
  return (
    <section
      id="top"
      className="starfield relative w-full overflow-hidden px-4 pb-12 pt-16 sm:px-6 sm:pb-14 sm:pt-24 lg:px-8 lg:pb-16 lg:pt-28"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[420px] max-w-full -translate-x-1/2 rounded-full bg-accent/20 blur-[120px]"
      />

      <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center text-center">
        <span className="rounded-full border border-subtle px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-ink-label">
          Machine-to-machine data payments
        </span>

        <h1 className="mt-6 w-full text-balance break-words font-display text-4xl font-bold leading-tight text-ink-heading sm:text-5xl md:text-6xl lg:text-7xl">
          Machines that <span className="text-gradient">negotiate</span> their own data prices.
        </h1>

        <p className="mt-6 w-full max-w-2xl text-balance break-words text-base leading-relaxed text-ink-body sm:text-lg">
          Metron is a negotiation and settlement layer for live financial and on-chain
          intelligence. Buyer agents propose a price, providers accept or counter, and payment
          settles through x402 on Base mainnet. No fixed price menus, no manual
          billing.
        </p>

        <div className="mt-10 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row sm:justify-center">
          <a
            href="#try-it"
            className="w-full rounded-xl bg-accent-gradient px-6 py-3 text-center text-sm font-semibold text-ink-heading shadow-glow transition-transform hover:scale-[1.02] sm:w-auto"
          >
            Try the negotiation
          </a>
          <a
            href="#how-it-works"
            className="w-full rounded-xl border border-subtle px-6 py-3 text-center text-sm font-semibold text-ink-heading transition-colors hover:border-strong sm:w-auto"
          >
            See how it works
          </a>
        </div>
      </div>
    </section>
  );
}
