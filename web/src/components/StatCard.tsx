export default function StatCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: React.ReactNode;
  sublabel?: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-subtle bg-surface-gradient p-6 shadow-glow">
      <p className="truncate text-xs font-medium uppercase tracking-wide text-ink-label">{label}</p>
      <p className="mt-2 truncate font-display text-3xl font-bold text-ink-heading">{value}</p>
      {sublabel ? <p className="mt-1 truncate text-xs text-ink-body">{sublabel}</p> : null}
    </div>
  );
}
