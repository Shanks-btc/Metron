export default function Callout({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="w-full min-w-0 rounded-xl border border-[rgba(139,124,246,0.28)] bg-[rgba(139,124,246,0.06)] p-4">
      {title ? (
        <p className="text-xs font-semibold uppercase tracking-wide text-accent-light">{title}</p>
      ) : null}
      <div className={`min-w-0 text-sm leading-relaxed text-ink-body ${title ? "mt-2" : ""}`}>
        {children}
      </div>
    </div>
  );
}
