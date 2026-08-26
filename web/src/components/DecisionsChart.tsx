// Status colors (fixed, reserved meaning - not themed categorical hues),
// validated for >=3:1 contrast against this site's dark canvas (#05060a)
// via the dataviz skill's validate_palette.js `contrast()` check:
// accepted #4ade80 -> 11.62:1, countered #fbbf24 -> 12.13:1, rejected
// #f87171 -> 7.32:1. Every segment is paired with a text label below, so
// color is never the only channel carrying meaning.
const STATUS = [
  { key: "accepted", label: "Accepted", color: "#4ade80" },
  { key: "countered", label: "Countered", color: "#fbbf24" },
  { key: "rejected", label: "Rejected", color: "#f87171" },
] as const;

const R = 70;
const STROKE = 28;
const CIRCUMFERENCE = 2 * Math.PI * R;
const GAP = 3;

export default function DecisionsChart({
  counts,
}: {
  counts: Record<"accepted" | "countered" | "rejected", number>;
}) {
  const total = counts.accepted + counts.countered + counts.rejected;

  let offset = 0;
  const segments = STATUS.map((s) => {
    const value = counts[s.key];
    const pct = total > 0 ? Math.round((value / total) * 100) : 0;
    const raw = total > 0 ? (value / total) * CIRCUMFERENCE : 0;
    const length = Math.max(raw - GAP, 0);
    const segment = { ...s, value, pct, length, offset };
    offset += raw;
    return segment;
  });

  return (
    <div className="flex w-full flex-col items-center gap-6 sm:flex-row sm:items-center sm:justify-center sm:gap-10">
      <div className="relative shrink-0">
        <svg viewBox="0 0 200 200" className="h-44 w-44" role="img" aria-label="Decisions breakdown donut chart">
          <circle cx="100" cy="100" r={R} fill="none" stroke="rgba(139,124,246,0.12)" strokeWidth={STROKE} />
          {total > 0 &&
            segments.map((seg) =>
              seg.value > 0 ? (
                <circle
                  key={seg.key}
                  cx="100"
                  cy="100"
                  r={R}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={STROKE}
                  strokeDasharray={`${seg.length} ${CIRCUMFERENCE - seg.length}`}
                  strokeDashoffset={-seg.offset}
                  strokeLinecap="butt"
                  transform="rotate(-90 100 100)"
                >
                  <title>{`${seg.label}: ${seg.value} (${seg.pct}%)`}</title>
                </circle>
              ) : null
            )}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-2xl font-bold text-ink-heading">{total}</span>
          <span className="text-[11px] text-ink-label">total</span>
        </div>
      </div>

      <div className="flex w-full max-w-xs min-w-0 flex-col gap-3">
        {segments.map((seg) => (
          <div key={seg.key} className="flex min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: seg.color }}
              />
              <span className="min-w-0 truncate text-sm text-ink-body">{seg.label}</span>
            </div>
            <span className="shrink-0 text-sm font-semibold text-ink-heading">
              {`${seg.value} `}
              <span className="font-normal text-ink-label">{`(${seg.pct}%)`}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
