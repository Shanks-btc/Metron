export interface ToolStat {
  tool: string;
  label: string;
  count: number;
  acceptanceRate: number | null;
}

export default function ToolBreakdown({ stats }: { stats: ToolStat[] }) {
  const maxCount = Math.max(1, ...stats.map((s) => s.count));

  return (
    <div className="flex w-full min-w-0 flex-col gap-5">
      {stats.map((s) => (
        <div key={s.tool} className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <span className="min-w-0 shrink-0 truncate text-sm text-ink-heading sm:w-44">
            {s.label}
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[rgba(139,124,246,0.12)]">
              <div
                className="h-full rounded-full bg-accent-gradient"
                style={{ width: `${(s.count / maxCount) * 100}%` }}
              />
            </div>
            <span className="shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-ink-label">
              {`${s.count} ${s.count === 1 ? "query" : "queries"}`}
            </span>
            <span className="shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-ink-body">
              {s.acceptanceRate !== null ? `${s.acceptanceRate}% acc.` : "—"}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
