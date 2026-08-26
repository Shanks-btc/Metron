export default function CodeBlock({ children, label }: { children: string; label?: string }) {
  return (
    <div className="w-full min-w-0 overflow-hidden rounded-xl border border-subtle bg-surface-gradient">
      {label ? (
        <div className="border-b border-subtle px-4 py-2 text-xs font-medium text-ink-label">
          {label}
        </div>
      ) : null}
      <pre className="w-full min-w-0 overflow-x-auto whitespace-pre-wrap break-all p-4 text-xs leading-relaxed text-ink-body sm:text-[13px]">
        <code className="font-mono">{children}</code>
      </pre>
    </div>
  );
}
