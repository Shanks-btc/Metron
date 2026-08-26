const POINTS = [
  {
    title: "One price, every request",
    body: "Most machine-readable APIs charge the same flat rate per call, no matter what the request is actually worth in the moment.",
  },
  {
    title: "Wrong price, wrong incentives",
    body: "That rigidity overcharges low-value requests and leaves high-value ones underpriced, with no way for either side to say what they're actually willing to pay or accept.",
  },
  {
    title: "Metron negotiates instead",
    body: "An agent proposes a price; the seller accepts, counters at its real cost floor, or rejects, settled instantly via x402 on Base.",
  },
];

export default function ProblemSection() {
  return (
    <section className="relative w-full overflow-hidden border-t border-subtle px-4 py-12 sm:px-6 sm:py-14 lg:px-8 lg:py-16">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center text-center">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-label">
          The problem
        </span>
        <h2 className="mt-4 w-full text-balance break-words font-display text-2xl font-bold text-ink-heading sm:text-3xl">
          A fixed price cannot reflect every request.
        </h2>
      </div>

      <div className="mx-auto mt-10 grid w-full max-w-5xl grid-cols-1 gap-6 lg:grid-cols-3">
        {POINTS.map((point) => (
          <div
            key={point.title}
            className="min-w-0 rounded-2xl border border-subtle bg-surface-gradient p-6 text-left shadow-glow"
          >
            <h3 className="font-display text-base font-bold text-ink-heading">
              {point.title}
            </h3>
            <p className="mt-2 break-words text-sm leading-relaxed text-ink-body">
              {point.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
