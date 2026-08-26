"use client";

import { useEffect, useState } from "react";
import { payWithWallet, BASE_EXPLORER_URL, BASE_NETWORK, BASE_USDC_ADDRESS } from "@/lib/payX402";
import { TOOL_LABELS } from "@/lib/activity";
import type { ToolPricing, PricingResponse } from "@/lib/pricing";

const QUOTE_URL =
  process.env.NEXT_PUBLIC_QUOTE_API_URL ?? "http://localhost:3000/quote";
const API_ORIGIN = new URL(QUOTE_URL).origin;
const PRICING_URL = `${API_ORIGIN}/pricing`;
const AGENT_QUOTE_URL = `${API_ORIGIN}/agent-quote`;

// Used only if /pricing can't be reached on mount - keeps the form usable
// (the /quote calls it makes will surface their own error via the existing
// fetch-failure handling below) rather than rendering an empty dropdown.
const FALLBACK_TOOLS: ToolPricing[] = [
  { tool: "get_btc_cycle_regime", costFloor: 0.003, askPrice: 0.008, requiredArgs: [] },
  { tool: "get_entry_risk", costFloor: 0.0015, askPrice: 0.004, requiredArgs: [] },
  { tool: "get_lth_behavior", costFloor: 0.0015, askPrice: 0.004, requiredArgs: [] },
  { tool: "compare_to_2021_top", costFloor: 0.002, askPrice: 0.005, requiredArgs: [] },
  { tool: "get_nupl_sentiment", costFloor: 0.0015, askPrice: 0.004, requiredArgs: [] },
];

// "ticker1" -> "Ticker 1", "ticker" -> "Ticker" - generic enough for any
// future requiredArgs name without a per-arg label table.
function argLabel(key: string): string {
  if (key === "tickers") return "Tickers (comma-separated, 2-5)";
  const spaced = key.replace(/(\d+)$/, " $1");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// screen_analyst_momentum's "tickers" is the one array-type required arg
// among all 10 tools today (everything else is a single ticker string) -
// stored in argValues as one raw comma-separated string like the other
// text inputs, split into a real array only when building the /quote
// payload. isArgFilled mirrors this for client-side validation so the
// submit button doesn't enable on e.g. a single ticker with no comma.
function splitTickers(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function isArgFilled(key: string, raw: string): boolean {
  if (key === "tickers") return splitTickers(raw).length >= 2;
  return !!raw.trim();
}

function buildArgsPayload(rawArgs: Record<string, string>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawArgs)) {
    payload[key] = key === "tickers" ? splitTickers(value) : value;
  }
  return payload;
}

const PRESETS: Array<{ label: string; tool: string; price: string; args?: Record<string, string> }> = [
  {
    label: "Accept at proposed — BTC Cycle Regime @ $0.006",
    tool: "get_btc_cycle_regime",
    price: "0.006",
  },
  {
    label: "Counter then accept — Entry Risk @ $0.001",
    tool: "get_entry_risk",
    price: "0.001",
  },
  {
    label: "Accept at ask — NUPL Sentiment @ $0.004",
    tool: "get_nupl_sentiment",
    price: "0.004",
  },
  {
    label: "Accept at ask — Squeeze Risk (GME) @ $0.008",
    tool: "get_squeeze_risk",
    price: "0.008",
    args: { ticker: "GME" },
  },
  {
    label: "Accept at ask — Analyst Momentum (PLTR) @ $0.07",
    tool: "get_analyst_momentum",
    price: "0.07",
    args: { ticker: "PLTR" },
  },
];

type QuoteResponse = {
  decision: "accept" | "counter" | "reject";
  reason: string;
  agreedPrice?: number;
  negotiationId?: string;
  round?: number;
  quoteId?: string;
  payUrl?: string;
};

// POST /agent-quote's response shape (server.ts) - the AI-agent path:
// pricingLayer.ts picks a tool and proposes a price for real, then
// negotiates via the same unchanged /quote + decide().
type AgentQuoteResponse = {
  answered: boolean;
  reason?: string;
  tool?: string;
  openingOffer?: number;
  walkAwayCeiling?: number;
  reasoningRecord?: {
    toolSelectionReasoning: string;
    pricingReasoning: string;
    clamped: { openingOffer: boolean; walkAwayCeiling: boolean };
  };
  decision?: "accept" | "counter" | "reject";
  negotiationId?: string;
  round?: number;
  quoteId?: string;
  agreed?: boolean;
  agreedPrice?: number;
  reasoningHash?: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const MAX_ROUNDS = 5;

export default function NegotiationSection() {
  const [tools, setTools] = useState<ToolPricing[]>(FALLBACK_TOOLS);
  const [tool, setTool] = useState(FALLBACK_TOOLS[0].tool);
  const [price, setPrice] = useState("0.006");
  const [argValues, setArgValues] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<string[]>([
    "$ metron — waiting for a proposal...",
  ]);
  const [pending, setPending] = useState(false);
  const [payState, setPayState] = useState<"idle" | "ready" | "paying" | "settled" | "error">(
    "idle"
  );
  const [agreedPrice, setAgreedPrice] = useState<number | null>(null);
  const [payerAddress, setPayerAddress] = useState<string | null>(null);
  const [settlementTxHash, setSettlementTxHash] = useState<string | null>(null);
  // Displayed in the "View as API call" panel's payTo field - sourced from
  // the same GET /pricing call that already supplies `tools`.
  const [sellerAddress, setSellerAddress] = useState<string | null>(null);
  const [agreedNegotiationId, setAgreedNegotiationId] = useState<string | null>(null);
  // The x402 payment gate (GET /pay/:id) is keyed by quoteId, not
  // negotiationId - captured separately since it's what handlePay() and the
  // API-call panel actually need to build the real payable URL.
  const [agreedQuoteId, setAgreedQuoteId] = useState<string | null>(null);

  // AI-agent path, sitting alongside the human-typed form above rather than
  // replacing it. "agent" mode has a genuine reasoningHash from POST
  // /agent-quote (real pricingLayer.ts run); "human" mode has none - there
  // is no real reasoning behind a manually typed number to hash - tracked
  // separately so handlePay can pass the right one through without the two
  // modes interfering with each other.
  const [mode, setMode] = useState<"human" | "agent">("human");
  const [agentQuestion, setAgentQuestion] = useState("What's the current BTC cycle regime?");
  const [agentMaxBudget, setAgentMaxBudget] = useState("0.05");
  const [agentPending, setAgentPending] = useState(false);
  const [agreedReasoningHash, setAgreedReasoningHash] = useState<string | null>(null);
  // Captured at the moment an agent negotiation is submitted, separate from
  // the live agentQuestion/agentMaxBudget form state - the form stays
  // editable after a negotiation completes, so reading those fields
  // directly when rendering "View as API call" could show a value the user
  // has since changed rather than what was actually sent for the
  // negotiation currently displayed in the terminal.
  const [submittedQuestion, setSubmittedQuestion] = useState<string | null>(null);
  const [submittedMaxBudget, setSubmittedMaxBudget] = useState<number | null>(null);
  const [showApiCall, setShowApiCall] = useState(false);

  // Live from the backend so newly-added tools (and their requiredArgs)
  // show up automatically - falls back to the hardcoded BTC-only list if
  // the backend is unreachable, so the form stays usable either way.
  useEffect(() => {
    let cancelled = false;
    fetch(PRICING_URL)
      .then((res) => (res.ok ? (res.json() as Promise<PricingResponse>) : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => {
        if (!cancelled && data.tools.length > 0) setTools(data.tools);
        if (!cancelled && data.sellerAddress) setSellerAddress(data.sellerAddress);
      })
      .catch(() => {
        // Keep FALLBACK_TOOLS - /quote's own fetch-failure handling below
        // already surfaces "backend unreachable" to the user if they submit.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedTool = tools.find((t) => t.tool === tool);
  const requiredArgs = selectedTool?.requiredArgs ?? [];
  const missingArgs = requiredArgs.filter((key) => !isArgFilled(key, argValues[key] ?? ""));

  async function appendLine(text: string) {
    setLines((prev) => [...prev, text]);
    await sleep(450);
  }

  function applyPreset(preset: (typeof PRESETS)[number]) {
    setTool(preset.tool);
    setPrice(preset.price);
    setArgValues(preset.args ?? {});
  }

  async function runNegotiation(selectedTool: string, startPrice: number, args: Record<string, unknown>) {
    setPending(true);
    setPayState("idle");
    setAgreedPrice(null);
    setPayerAddress(null);
    setSettlementTxHash(null);
    setLines([`$ metron quote ${selectedTool} --price ${startPrice}`]);

    let currentPrice = startPrice;
    let negotiationId: string | undefined;

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      await appendLine(
        round === 1
          ? `> Proposing $${currentPrice}...`
          : `> Re-proposing at $${currentPrice}...`
      );

      let json: QuoteResponse;
      try {
        const res = await fetch(QUOTE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool: selectedTool,
            proposedPrice: currentPrice,
            negotiationId,
            args,
          }),
        });
        json = await res.json();
      } catch {
        await appendLine(
          "> Error: could not reach Metron API at localhost:3000 (is the server running?)"
        );
        setPending(false);
        return;
      }

      negotiationId = json.negotiationId;

      if (json.decision === "reject") {
        await appendLine(`> Rejected — ${json.reason}`);
        setPending(false);
        return;
      }

      if (json.decision === "counter" && typeof json.agreedPrice === "number") {
        await appendLine(
          `> Seller countered at $${json.agreedPrice} — '${json.reason}'`
        );
        currentPrice = json.agreedPrice;
        continue;
      }

      if (json.decision === "accept" && typeof json.agreedPrice === "number") {
        await appendLine(`> Accepted at $${json.agreedPrice} — ${json.reason}`);
        setAgreedPrice(json.agreedPrice);
        setAgreedNegotiationId(negotiationId ?? null);
        setAgreedQuoteId(json.quoteId ?? null);
        setPayState("ready");
        setPending(false);
        return;
      }

      await appendLine("> Unexpected response from server.");
      setPending(false);
      return;
    }

    await appendLine(`> Max negotiation rounds (${MAX_ROUNDS}) exceeded.`);
    setPending(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = Number(price);
    if (Number.isNaN(parsed) || parsed < 0 || pending || missingArgs.length > 0) return;
    await runNegotiation(tool, parsed, buildArgsPayload(argValues));
  }

  // The AI-agent path. Unlike runNegotiation (human types a number and hits
  // /quote directly), this hits POST /agent-quote - a real Anthropic call
  // happens server-side (pricingLayer.ts), visibly narrated here via the
  // same terminal, before the same real /quote + decide().
  async function runAgentNegotiation(question: string, maxBudget: number) {
    setAgentPending(true);
    setPayState("idle");
    setAgreedPrice(null);
    setPayerAddress(null);
    setSettlementTxHash(null);
    setAgreedReasoningHash(null);
    setShowApiCall(false);
    setSubmittedQuestion(question);
    setSubmittedMaxBudget(maxBudget);
    setLines([`$ metron agent — "${question}" (max budget $${maxBudget})`]);

    let json: AgentQuoteResponse;
    try {
      await appendLine("> Asking the AI agent to pick a tool and propose a price...");
      const res = await fetch(AGENT_QUOTE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, maxBudget }),
      });
      json = await res.json();
    } catch {
      await appendLine("> Error: could not reach the agent API (is the server running?)");
      setAgentPending(false);
      return;
    }

    if (!json.answered || !json.tool) {
      await appendLine(`> No tool matched — ${json.reason ?? "unknown reason"}`);
      setAgentPending(false);
      return;
    }

    setTool(json.tool);
    await appendLine(`> Tool selected: ${TOOL_LABELS[json.tool] ?? json.tool}`);
    if (json.reasoningRecord) {
      await appendLine(`> Why this tool: ${json.reasoningRecord.toolSelectionReasoning}`);
      await appendLine(`> Pricing reasoning: ${json.reasoningRecord.pricingReasoning}`);
      const { openingOffer: clampedOpen, walkAwayCeiling: clampedCeil } = json.reasoningRecord.clamped;
      if (clampedOpen || clampedCeil) {
        await appendLine(`> Policy clamp applied (opening=${clampedOpen}, ceiling=${clampedCeil}) - the LLM's raw proposal exceeded maxBudget and was corrected in code.`);
      }
    }
    await appendLine(`> Opening offer: $${json.openingOffer} — walk-away ceiling: $${json.walkAwayCeiling}`);
    await appendLine(`> decide() said: ${json.decision} — ${json.reason}`);

    if (!json.agreed || typeof json.agreedPrice !== "number" || !json.negotiationId) {
      setAgentPending(false);
      return;
    }

    await appendLine(`> Reasoning hash committed for this deal: ${json.reasoningHash}`);
    setAgreedPrice(json.agreedPrice);
    setAgreedNegotiationId(json.negotiationId);
    setAgreedQuoteId(json.quoteId ?? null);
    setAgreedReasoningHash(json.reasoningHash ?? null);
    setPayState("ready");
    setAgentPending(false);
  }

  async function handleAgentSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = Number(agentMaxBudget);
    if (!agentQuestion.trim() || Number.isNaN(parsed) || parsed <= 0 || agentPending) return;
    await runAgentNegotiation(agentQuestion.trim(), parsed);
  }

  async function handlePay() {
    if (agreedPrice === null || !agreedQuoteId) return;
    setPayState("paying");
    await appendLine("> Requesting wallet connection...");

    try {
      const result = await payWithWallet(
        { payUrl: `${API_ORIGIN}/pay/${agreedQuoteId}` },
        appendLine
      );
      setPayerAddress(result.payerAddress);
      setSettlementTxHash(result.transactionHash);
      await appendLine(`> Buyer: ${result.buyer}`);
      await appendLine(`> ${result.responseBody.message}`);
      setPayState("settled");
    } catch (err: any) {
      await appendLine(`> Payment failed — ${err?.message ?? "unknown error"}`);
      setPayState("error");
    }
  }

  // Derived only for the "View as API call" panel - real values from the
  // negotiation currently on screen.
  const agreedAmountUnits = agreedPrice !== null ? Math.round(agreedPrice * 1_000_000) : null;

  return (
    <section
      id="try-it"
      className="relative w-full overflow-hidden border-t border-subtle bg-[#5b3fd6] px-4 py-12 sm:px-6 sm:py-14 lg:px-8 lg:py-16"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 max-w-full rounded-full bg-white/10 blur-[100px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 max-w-full rounded-full bg-black/10 blur-[100px]"
      />

      <div className="relative mx-auto w-full max-w-5xl">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-medium uppercase tracking-wide text-white/70">
            Live demo
          </span>
          <h2 className="mt-4 w-full text-balance break-words font-display text-3xl font-bold text-white sm:text-4xl">
            Try a negotiation yourself.
          </h2>
          <p className="mt-4 w-full text-balance break-words text-sm leading-relaxed text-white/80 sm:text-base">
            Pick a data tool, propose a price, and watch the seller accept,
            counter, or reject it in real time.
          </p>
        </div>

        <div className="mx-auto mt-8 flex w-full max-w-md gap-2 rounded-xl border border-white/20 bg-black/10 p-1">
          <button
            type="button"
            onClick={() => setMode("human")}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              mode === "human" ? "bg-white text-[#5b3fd6]" : "text-white/80 hover:text-white"
            }`}
          >
            Human-typed price
          </button>
          <button
            type="button"
            onClick={() => setMode("agent")}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              mode === "agent" ? "bg-white text-[#5b3fd6]" : "text-white/80 hover:text-white"
            }`}
          >
            AI agent
          </button>
        </div>

        <div className="mx-auto mt-6 grid w-full grid-cols-1 gap-6 lg:mt-8 lg:grid-cols-2 lg:gap-8">
          {mode === "agent" ? (
            <form
              onSubmit={handleAgentSubmit}
              className="w-full min-w-0 rounded-2xl border border-subtle bg-surface-gradient p-6 shadow-glow sm:p-8"
            >
              <div className="flex flex-col gap-2">
                <label htmlFor="agent-question" className="text-xs font-medium uppercase tracking-wide text-ink-label">
                  Question
                </label>
                <textarea
                  id="agent-question"
                  value={agentQuestion}
                  onChange={(e) => setAgentQuestion(e.target.value)}
                  rows={3}
                  className="w-full min-w-0 rounded-lg border border-subtle bg-canvas px-3 py-2 text-sm text-ink-heading"
                />
              </div>

              <div className="mt-4 flex flex-col gap-2">
                <label htmlFor="agent-budget" className="text-xs font-medium uppercase tracking-wide text-ink-label">
                  Max budget (USDC)
                </label>
                <input
                  id="agent-budget"
                  type="number"
                  min="0"
                  step="0.0001"
                  value={agentMaxBudget}
                  onChange={(e) => setAgentMaxBudget(e.target.value)}
                  className="w-full min-w-0 rounded-lg border border-subtle bg-canvas px-3 py-2 text-sm text-ink-heading"
                />
              </div>

              <p className="mt-4 text-xs leading-relaxed text-ink-label">
                An LLM (bounded by this budget in code, not just by prompt) picks the tool and proposes both an
                opening offer and a walk-away ceiling - real, not scripted.
              </p>

              <button
                type="submit"
                disabled={agentPending || !agentQuestion.trim()}
                className="mt-6 w-full rounded-xl bg-accent-gradient px-6 py-3 text-sm font-semibold text-ink-heading transition-opacity disabled:opacity-50"
              >
                {agentPending ? "Agent negotiating..." : "Ask the AI agent to negotiate"}
              </button>
            </form>
          ) : (
          <form
            onSubmit={handleSubmit}
            className="w-full min-w-0 rounded-2xl border border-subtle bg-surface-gradient p-6 shadow-glow sm:p-8"
          >
            <div className="flex flex-col gap-2">
              <label
                htmlFor="tool"
                className="text-xs font-medium uppercase tracking-wide text-ink-label"
              >
                Tool
              </label>
              <select
                id="tool"
                value={tool}
                onChange={(e) => {
                  setTool(e.target.value);
                  setArgValues({});
                }}
                className="w-full min-w-0 rounded-lg border border-subtle bg-canvas px-3 py-2 text-sm text-ink-heading"
              >
                {tools.map((t) => (
                  <option key={t.tool} value={t.tool}>
                    {TOOL_LABELS[t.tool] ?? t.tool}
                  </option>
                ))}
              </select>
            </div>

            {requiredArgs.length > 0 && (
              <div className="mt-4 flex flex-col gap-2">
                {requiredArgs.map((key) => (
                  <div key={key} className="flex flex-col gap-2">
                    <label
                      htmlFor={`arg-${key}`}
                      className="text-xs font-medium uppercase tracking-wide text-ink-label"
                    >
                      {argLabel(key)}
                    </label>
                    <input
                      id={`arg-${key}`}
                      type="text"
                      placeholder={
                        key === "tickers"
                          ? "e.g. PLTR, NVDA, AMD, TSLA"
                          : key.startsWith("ticker")
                          ? "e.g. GME"
                          : undefined
                      }
                      value={argValues[key] ?? ""}
                      onChange={(e) =>
                        setArgValues((prev) => ({ ...prev, [key]: e.target.value.toUpperCase() }))
                      }
                      className="w-full min-w-0 rounded-lg border border-subtle bg-canvas px-3 py-2 text-sm text-ink-heading"
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 flex flex-col gap-2">
              <label
                htmlFor="price"
                className="text-xs font-medium uppercase tracking-wide text-ink-label"
              >
                Proposed price (USDC)
              </label>
              <input
                id="price"
                type="number"
                min="0"
                step="0.0001"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full min-w-0 rounded-lg border border-subtle bg-canvas px-3 py-2 text-sm text-ink-heading"
              />
            </div>

            <button
              type="submit"
              disabled={pending || missingArgs.length > 0}
              className="mt-6 w-full rounded-xl bg-accent-gradient px-6 py-3 text-sm font-semibold text-ink-heading transition-opacity disabled:opacity-50"
            >
              {pending
                ? "Negotiating..."
                : missingArgs.length > 0
                ? `Enter ${missingArgs.map(argLabel).join(", ")}`
                : "Propose price"}
            </button>

            <div className="mt-6 min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-label">
                Or try a preset
              </p>
              <div className="mt-3 flex w-full flex-col gap-2">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className="w-full min-w-0 break-words rounded-lg border border-subtle px-3 py-2 text-left text-xs text-ink-body transition-colors hover:border-strong"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </form>
          )}

          <div className="flex w-full min-w-0 flex-col gap-4">
            <div className="w-full max-w-full overflow-hidden rounded-2xl border border-subtle bg-surface-gradient shadow-glow">
              <div className="flex items-center gap-2 border-b border-subtle px-4 py-3">
                <span className="h-3 w-3 shrink-0 rounded-full bg-[#ff5f56]" />
                <span className="h-3 w-3 shrink-0 rounded-full bg-[#ffbd2e]" />
                <span className="h-3 w-3 shrink-0 rounded-full bg-[#27c93f]" />
                <span className="ml-2 min-w-0 truncate text-xs text-ink-label">
                  metron — negotiation
                </span>
              </div>
              {/* min-height (not a fixed height) with no internal scroll -
                  the agent-mode transcript (tool selection + pricing
                  reasoning + reasoning-hash line) is regularly longer than
                  the human-typed flow's short log, and a fixed h-72/h-80
                  scrollbox was hiding the tail of it inside its own small
                  scroll container instead of letting the page grow to show
                  it. min-h keeps the box a sensible size when the log is
                  short, but never clips or scroll-traps longer content. */}
              <div className="min-h-72 w-full max-w-full overflow-x-hidden px-4 py-4 sm:min-h-80">
                <pre className="w-full max-w-full whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-ink-body sm:text-xs">
                  {lines.join("\n")}
                  {pending ? <span className="animate-pulse">▍</span> : null}
                </pre>

                {payState === "settled" && (payerAddress || settlementTxHash) && (
                  <a
                    href={
                      settlementTxHash
                        ? `${BASE_EXPLORER_URL}/tx/${settlementTxHash}`
                        : `${BASE_EXPLORER_URL}/address/${payerAddress}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex w-full min-w-0 items-center gap-1.5 truncate rounded-lg border border-success/40 bg-success/10 px-3 py-2 font-mono text-[11px] font-semibold text-success underline underline-offset-2 transition-colors hover:border-success sm:text-xs"
                  >
                    {"> View on Basescan →"}
                  </a>
                )}
              </div>
            </div>

            {payState !== "idle" && agreedPrice !== null && (
              <div className="flex w-full min-w-0 flex-col gap-3">
                <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={handlePay}
                    disabled={payState === "paying" || payState === "settled"}
                    className="w-full flex-1 rounded-xl bg-success px-6 py-3 text-sm font-semibold text-[#05060a] transition-opacity disabled:opacity-60"
                  >
                    {payState === "ready" && `Pay $${agreedPrice} with wallet`}
                    {payState === "paying" && "Confirm in wallet..."}
                    {payState === "settled" && "Settled ✓"}
                    {payState === "error" && "Retry payment"}
                  </button>

                  {mode === "agent" && submittedQuestion !== null && submittedMaxBudget !== null && (
                    <button
                      type="button"
                      onClick={() => setShowApiCall((v) => !v)}
                      className="w-full flex-1 rounded-xl bg-success px-6 py-3 text-sm font-semibold text-[#05060a] transition-opacity hover:opacity-90 sm:flex-none sm:w-auto"
                    >
                      {showApiCall ? "Hide API call" : "View as API call"}
                    </button>
                  )}
                </div>

                {mode === "agent" && showApiCall && submittedQuestion !== null && submittedMaxBudget !== null && (
                  // One unified card (one border, one background) with the
                  // two steps as internally-labeled subsections divided by
                  // a border-t, rather than two separate CodeBlock
                  // instances with a gap between them - reuses CodeBlock's
                  // own label/pre styling directly (same classNames) rather
                  // than the component itself, since CodeBlock's public API
                  // is one label + one code body, and duplicating it inline
                  // here is simpler than reworking that API for a single
                  // two-part use case.
                  <div className="w-full min-w-0 overflow-hidden rounded-xl border border-subtle bg-surface-gradient">
                    <div className="border-b border-subtle px-4 py-2 text-xs font-medium text-ink-label">
                      1. Propose &amp; negotiate — POST /agent-quote (real request + real response from this negotiation)
                    </div>
                    <pre className="w-full min-w-0 overflow-x-auto whitespace-pre-wrap break-all p-4 text-xs leading-relaxed text-ink-body sm:text-[13px]">
                      <code className="font-mono">
{`$ curl -X POST ${AGENT_QUOTE_URL} \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({ question: submittedQuestion, maxBudget: submittedMaxBudget })}'

${JSON.stringify(
  {
    answered: true,
    agreed: payState === "settled" || payState === "paying" || payState === "ready" || payState === "error",
    tool,
    agreedPrice,
    negotiationId: agreedNegotiationId,
    quoteId: agreedQuoteId,
    reasoningHash: agreedReasoningHash,
  },
  null,
  2
)}`}
                      </code>
                    </pre>

                    <div className="border-t border-subtle px-4 py-2 text-xs font-medium text-ink-label">
                      2. Settle — a single gated HTTP call, not a wallet contract call. The buyer's wallet signs an EIP-3009 payment authorization; Coinbase's hosted x402 facilitator verifies and settles it on {BASE_NETWORK}.
                    </div>
                    <pre className="w-full min-w-0 overflow-x-auto whitespace-pre-wrap break-all p-4 text-xs leading-relaxed text-ink-body sm:text-[13px]">
                      <code className="font-mono">
{`GET ${API_ORIGIN}/pay/${agreedQuoteId ?? "{quoteId}"}
  Header: PAYMENT-SIGNATURE: <base64 EIP-3009 authorization, signed by your wallet>

  scheme: exact
  network: ${BASE_NETWORK}
  asset: ${BASE_USDC_ADDRESS} (USDC)
  amount: ${agreedAmountUnits ?? "<amount>"}
  payTo: ${sellerAddress ?? "<seller address>"}

← 200 OK
  Header: PAYMENT-RESPONSE: <base64 settlement receipt: payer, transaction, network>
  {
    "message": "Payment accepted - here is your data.",
    "tool": "${tool}",
    "agreedPrice": ${agreedPrice ?? 0},
    "data": { ... },
    "negotiationId": "${agreedNegotiationId ?? ""}",
    "round": 1,
    "payerAddress": "${payerAddress ?? "<payer address>"}"
  }`}
                      </code>
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
