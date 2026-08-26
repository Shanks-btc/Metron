interface FooterLink {
  label: string;
  href: string;
  external?: boolean;
}

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Getting Started",
    links: [
      { label: "Try It", href: "/#try-it" },
      { label: "Docs", href: "/docs" },
      { label: "GitHub", href: "https://github.com/Shanks-btc/Metron", external: true },
    ],
  },
  {
    title: "The App",
    links: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "How It Works", href: "/#how-it-works" },
    ],
  },
  {
    title: "The Protocol",
    links: [
      { label: "x402 Docs", href: "https://docs.cdp.coinbase.com/x402", external: true },
      { label: "Basescan", href: "https://basescan.org", external: true },
    ],
  },
];

function FooterColumn({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-accent-light">{title}</p>
      <ul className="mt-4 flex flex-col gap-3">
        {links.map((link) => (
          <li key={link.label} className="min-w-0">
            <a
              href={link.href}
              target={link.external ? "_blank" : undefined}
              rel={link.external ? "noopener noreferrer" : undefined}
              className="block min-w-0 truncate text-sm text-ink-body transition-colors hover:text-accent-light"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="w-full border-t border-subtle bg-canvas px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-10 lg:flex-row lg:justify-between">
        <div className="min-w-0 max-w-xs">
          <a href="/" className="font-display text-xl font-bold text-ink-heading">
            Metron
          </a>
          <p className="mt-3 min-w-0 text-sm leading-relaxed text-ink-body">
            Machine-to-machine data payments
          </p>
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-8 sm:grid-cols-3 sm:gap-10 lg:gap-16">
          {COLUMNS.map((column) => (
            <FooterColumn key={column.title} title={column.title} links={column.links} />
          ))}
        </div>
      </div>

      <div className="mx-auto mt-10 w-full max-w-6xl border-t border-subtle pt-6">
        <p className="text-xs text-ink-label">{`© ${year} Metron`}</p>
      </div>
    </footer>
  );
}
