import { TOOL_LABELS } from "@/lib/activity";
import type { ToolPricing } from "@/lib/pricing";

export default function PricingTable({ tools }: { tools: ToolPricing[] }) {
  if (tools.length === 0) {
    return (
      <div className="w-full rounded-2xl border border-subtle bg-surface-gradient p-6 text-center text-sm text-ink-body">
        Pricing data is unavailable — the backend may be offline.
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 overflow-x-auto rounded-2xl border border-subtle bg-surface-gradient shadow-glow">
      <table className="w-full min-w-[520px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-subtle text-xs uppercase tracking-wide text-ink-label">
            <th className="px-4 py-3 font-medium">Tool</th>
            <th className="px-4 py-3 font-medium">Cost floor</th>
            <th className="px-4 py-3 font-medium">Asking price</th>
            <th className="px-4 py-3 font-medium">Negotiation range</th>
          </tr>
        </thead>
        <tbody>
          {tools.map((t, i) => {
            const rangePct = t.askPrice > 0 ? Math.round(((t.askPrice - t.costFloor) / t.askPrice) * 100) : 0;
            return (
              <tr key={t.tool} className={i !== tools.length - 1 ? "border-b border-subtle" : undefined}>
                <td className="min-w-0 max-w-[200px] truncate px-4 py-3 text-ink-heading">
                  {TOOL_LABELS[t.tool] ?? t.tool}
                </td>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-body">{`$${t.costFloor}`}</td>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-body">{`$${t.askPrice}`}</td>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-heading">{`${rangePct}%`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
