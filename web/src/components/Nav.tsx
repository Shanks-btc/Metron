"use client";

import { useState } from "react";

const LINKS = [
  { href: "/#how-it-works", label: "How It Works" },
  { href: "/#try-it", label: "Try It" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/docs", label: "Docs" },
];

export default function Nav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-subtle bg-canvas/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <a
          href="/"
          className="min-w-0 shrink-0 font-display text-xl font-bold tracking-tight text-ink-heading"
        >
          Metron
        </a>

        <nav className="hidden items-center gap-8 lg:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-ink-body transition-colors hover:text-ink-heading"
            >
              {link.label}
            </a>
          ))}
          <a
            href="https://github.com/Shanks-btc/Metron"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-ink-body transition-colors hover:text-ink-heading"
          >
            GitHub
          </a>
        </nav>

        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-subtle text-ink-heading lg:hidden"
        >
          <span className="text-xl leading-none">{open ? "✕" : "≡"}</span>
        </button>
      </div>

      {open && (
        <div
          data-mobile-nav
          className="w-full border-t border-subtle bg-canvas px-4 pb-4 pt-2 sm:px-6 lg:hidden"
        >
          <div className="flex w-full flex-col gap-2">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="w-full rounded-lg border border-subtle px-4 py-3 text-center text-sm font-medium text-ink-heading transition-colors hover:border-strong"
              >
                {link.label}
              </a>
            ))}
            <a
              href="https://github.com/Shanks-btc/Metron"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="w-full rounded-lg border border-subtle px-4 py-3 text-center text-sm font-medium text-ink-heading transition-colors hover:border-strong"
            >
              GitHub
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
