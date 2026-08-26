export default function SavingsCallout({
  avgSavingsPct,
  dealCount,
}: {
  avgSavingsPct: number | null;
  dealCount: number;
}) {
  if (avgSavingsPct === null) {
    return null;
  }

  return (
    <div className="mx-auto mt-6 flex w-full max-w-xl min-w-0 items-center justify-center gap-2 rounded-full border border-[rgba(139,124,246,0.28)] bg-success/10 px-5 py-2.5 text-center">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
      <span className="min-w-0 text-sm text-ink-body">
        {"Accepted deals settled "}
        <span className="font-semibold text-success">{`${avgSavingsPct}% below list price`}</span>
        {` on average, across ${dealCount} deal${dealCount === 1 ? "" : "s"}.`}
      </span>
    </div>
  );
}
