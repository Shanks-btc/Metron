const SECTIONS = [
  {
    title: "Getting Started",
    items: [
      { href: "#overview", label: "Overview" },
      { href: "#architecture", label: "Architecture" },
    ],
  },
  {
    title: "API Reference",
    items: [
      { href: "#api-quote", label: "POST /quote" },
      { href: "#api-pay", label: "GET /pay/:id" },
      { href: "#api-activity", label: "GET /activity" },
      { href: "#api-pricing", label: "GET /pricing" },
      { href: "#api-agent-quote", label: "POST /agent-quote" },
      { href: "#api-reasoning", label: "GET /reasoning/:negotiationId" },
    ],
  },
  {
    title: "How Negotiation Works",
    items: [
      { href: "#negotiation-modes", label: "Two negotiation modes" },
      { href: "#negotiation-logic", label: "Decision logic" },
      { href: "#negotiation-sessions", label: "Sessions & rounds" },
    ],
  },
  {
    title: "Payments & Settlement",
    items: [
      { href: "#settlement-x402", label: "x402 settlement (Base)" },
      { href: "#settlement-reasoning-hash", label: "Reasoning-hash audit record" },
    ],
  },
  {
    title: "Limitations & Roadmap",
    items: [{ href: "#limitations", label: "Known limitations" }],
  },
];

function NavGroups() {
  return (
    <>
      {SECTIONS.map((group) => (
        <div key={group.title} className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-label">
            {group.title}
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {group.items.map((item) => (
              <li key={item.href} className="min-w-0">
                <a
                  href={item.href}
                  className="block min-w-0 truncate rounded-md px-2 py-1 text-sm text-ink-body transition-colors hover:bg-[rgba(139,124,246,0.08)] hover:text-ink-heading"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

export default function DocsSidebar() {
  return (
    <>
      {/* Mobile / tablet: collapsible table of contents above the content */}
      <details className="mb-8 w-full min-w-0 rounded-2xl border border-subtle bg-surface-gradient p-4 lg:hidden">
        <summary className="cursor-pointer font-display text-sm font-semibold text-ink-heading">
          On this page
        </summary>
        <nav className="mt-4 flex w-full min-w-0 flex-col gap-5">
          <NavGroups />
        </nav>
      </details>

      {/* Desktop: sticky sidebar */}
      <aside className="hidden w-56 shrink-0 lg:block">
        <nav className="sticky top-24 flex max-h-[calc(100vh-7rem)] w-full flex-col gap-5 overflow-y-auto pb-8">
          <NavGroups />
        </nav>
      </aside>
    </>
  );
}
