/**
 * Bounded-LLM pricing layer - sits between a buyer's natural-language
 * question and the existing, unchanged POST /quote negotiation flow. Turns
 * the AI from a pure router (reasoning.ts, tool selection only) into a
 * bounded economic actor: an LLM proposes an opening offer and a walk-away
 * ceiling, but the *policy bounds are enforced in code*, not by the prompt.
 * decide() on the server remains the sole accept/counter/reject authority -
 * this layer only ever produces a proposedPrice for /quote to negotiate
 * against, exactly like a human typing a number into the demo UI would.
 *
 * Tool selection: reasoning.ts's selectTool() is reused, not reimported
 * directly here. Reusing it directly would require either duplicating
 * server.ts's TOOLS map (mcpUrl per tool) in this file, or exporting TOOLS
 * from server.ts - both are effectively off-limits, since TOOLS is on the
 * inherited "do not modify" list and this file must not become a second,
 * drifting copy of it. Going through the server's own existing POST /ask
 * endpoint instead gets the same reasoning.ts selectTool() call, unmodified,
 * plus the costFloor/askPrice metadata /ask already merges in - without
 * this file ever touching server.ts internals. See the Phase 3 report for
 * the full reasoning on this choice.
 *
 * This module does not build the reasoning-hash mechanism itself (see
 * architecture.md) - it only returns a clean, canonical, JSON-serializable
 * reasoningRecord shaped for that later keccak256 step to consume as-is.
 */

import Anthropic from "@anthropic-ai/sdk";

const NEGOTIATOR_URL = process.env.NEGOTIATOR_URL ?? "http://localhost:3000";

let client: Anthropic | undefined;

// Same lazy-singleton pattern as reasoning.ts's getClient() - duplicated
// rather than imported because reasoning.ts does not export it, and it is
// six lines with no logic worth sharing a module boundary over.
function getClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("Missing ANTHROPIC_API_KEY - required for the pricing layer");
    }
    client = new Anthropic();
  }
  return client;
}

export interface PricingPolicy {
  maxBudget: number;
  minDataFreshness?: string;
  acceptablePriceRange?: { min: number; max: number };
}

export interface ReasoningRecord {
  policy: PricingPolicy;
  question: string;
  tool: string;
  toolSelectionReasoning: string;
  toolPriceRange: { costFloor: number; askPrice: number } | null;
  pricingReasoning: string;
  openingOfferRaw: number;
  walkAwayCeilingRaw: number;
  openingOffer: number;
  walkAwayCeiling: number;
  clamped: { openingOffer: boolean; walkAwayCeiling: boolean };
  timestamp: string;
}

export interface QuoteOutcome {
  decision: "accept" | "reject" | "counter";
  quoteId?: string;
  agreedPrice?: number;
  reason: string;
  negotiationId: string;
  round: number;
}

export type PricingLayerResult =
  | { ok: false; reason: string }
  | {
      ok: true;
      tool: string;
      openingOffer: number;
      walkAwayCeiling: number;
      reasoningRecord: ReasoningRecord;
      quote: QuoteOutcome;
    };

interface AskResponse {
  answered: boolean;
  tool?: string;
  reasoning: string;
  confidence?: "high" | "medium" | "low";
  costFloor?: number;
  askPrice?: number;
  requiredArgs?: string[];
}

async function askServer(question: string): Promise<AskResponse> {
  const res = await fetch(`${NEGOTIATOR_URL}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) throw new Error(`POST /ask returned HTTP ${res.status}`);
  return (await res.json()) as AskResponse;
}

// Same fetch/body/response shape as buyer-agent/index.ts's negotiate()
// loop's /quote call. Not imported from there directly - buyer-agent's
// negotiate() is an unexported function inside a script with its own
// argv-parsing/side-effecting main(), and buyer-agent/index.ts's existing
// structure is on the do-not-modify list, so adding an export to it is not
// an option here. This mirrors the same request/response shape instead.
export async function callQuote(
  tool: string,
  args: Record<string, unknown>,
  proposedPrice: number,
  negotiationId?: string
): Promise<QuoteOutcome> {
  const res = await fetch(`${NEGOTIATOR_URL}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, args, proposedPrice, ...(negotiationId ? { negotiationId } : {}) }),
  });
  if (!res.ok) throw new Error(`POST /quote returned HTTP ${res.status}`);
  return (await res.json()) as QuoteOutcome;
}

interface PricingProposal {
  openingOffer: number;
  walkAwayCeiling: number;
  reasoning: string;
}

export interface ClampResult {
  openingOffer: number;
  walkAwayCeiling: number;
  clamped: { openingOffer: boolean; walkAwayCeiling: boolean };
}

/**
 * The actual hard enforcement: pulled out as its own pure function (no LLM
 * call, no network) so it is directly, deterministically testable on its
 * own - proof that a real out-of-bounds value gets clamped never depends on
 * whether a given LLM call happens to already stay in-bounds. Only clamps
 * DOWN against policy.maxBudget (never up, and never against
 * policy.acceptablePriceRange - see the module-level comment on why that
 * field is prompt-only context, not a second hard-coded bound), and floors
 * at 0 as a minimal sanity guard against a nonsensical negative value.
 */
export function clampToPolicy(proposal: { openingOffer: number; walkAwayCeiling: number }, policy: PricingPolicy): ClampResult {
  const openingOfferClamped = proposal.openingOffer > policy.maxBudget;
  const walkAwayCeilingClamped = proposal.walkAwayCeiling > policy.maxBudget;
  return {
    openingOffer: Math.max(0, openingOfferClamped ? policy.maxBudget : proposal.openingOffer),
    walkAwayCeiling: Math.max(0, walkAwayCeilingClamped ? policy.maxBudget : proposal.walkAwayCeiling),
    clamped: { openingOffer: openingOfferClamped, walkAwayCeiling: walkAwayCeilingClamped },
  };
}

async function proposePricing(
  question: string,
  policy: PricingPolicy,
  toolPriceRange: { costFloor: number; askPrice: number } | null
): Promise<PricingProposal> {
  const rangeText = toolPriceRange
    ? `This tool's typical price range: cost floor $${toolPriceRange.costFloor}, ask price $${toolPriceRange.askPrice}.`
    : "No typical price range is available for this tool.";

  const policyText = [
    `Max budget: $${policy.maxBudget}`,
    policy.minDataFreshness ? `Minimum data freshness: ${policy.minDataFreshness}` : null,
    policy.acceptablePriceRange
      ? `Acceptable price range: $${policy.acceptablePriceRange.min} - $${policy.acceptablePriceRange.max}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await getClient().messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 512,
    system:
      "You are a bounded economic negotiating agent buying data on behalf of a user, in a marketplace where a " +
      "seller's decide() logic will accept, counter, or reject your opening offer. Given a budget policy and a " +
      "tool's typical price range, propose: (a) a reasonable OPENING offer to propose first (not simply your max " +
      "budget - a real negotiating opener, informed by the tool's typical price range if given), and (b) a WALK-AWAY " +
      "CEILING - the highest price you would ultimately accept if the seller counters. Both numbers must be positive " +
      "and must never exceed the stated max budget under any circumstances - the max budget is a hard constraint, " +
      "not a target. Explain your reasoning briefly.",
    messages: [
      {
        role: "user",
        content: `Question: "${question}"\n\nPolicy:\n${policyText}\n\n${rangeText}`,
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            openingOffer: { type: "number", description: "The opening price to propose first, in USD." },
            walkAwayCeiling: { type: "number", description: "The maximum price to ultimately accept, in USD." },
            reasoning: { type: "string", description: "Brief explanation of both numbers, inspectable by the caller." },
          },
          required: ["openingOffer", "walkAwayCeiling", "reasoning"],
          additionalProperties: false,
        },
      },
    },
  });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("LLM returned no text content for pricing proposal");
  }
  return JSON.parse(block.text) as PricingProposal;
}

/**
 * End to end: question + policy -> tool selection (via /ask, i.e.
 * reasoning.ts unmodified) -> bounded LLM pricing proposal -> hard clamp
 * against policy.maxBudget -> POST /quote with the resulting opening offer.
 *
 * Deliberately does NOT call openDeal or touch the contract - that is the
 * next phase, once the reasoning-hash mechanism itself exists. reasoningRecord
 * on the successful result is exactly the object that phase will keccak256
 * and commit on-chain; it is not hashed here.
 */
export async function proposeAndNegotiate(
  question: string,
  policy: PricingPolicy,
  args: Record<string, unknown> = {}
): Promise<PricingLayerResult> {
  const ask = await askServer(question);
  if (!ask.answered || !ask.tool) {
    return { ok: false, reason: `No tool matched this question: ${ask.reasoning}` };
  }

  const toolPriceRange =
    typeof ask.costFloor === "number" && typeof ask.askPrice === "number"
      ? { costFloor: ask.costFloor, askPrice: ask.askPrice }
      : null;

  const proposal = await proposePricing(question, policy, toolPriceRange);

  // Hard enforcement: the LLM's numbers are clamped here, in code (see
  // clampToPolicy above), not just requested via the prompt. A prompt is a
  // request the model can get wrong or ignore; this is the actual guarantee
  // the rest of the system can rely on.
  const { openingOffer, walkAwayCeiling, clamped } = clampToPolicy(proposal, policy);

  const reasoningRecord: ReasoningRecord = {
    policy,
    question,
    tool: ask.tool,
    toolSelectionReasoning: ask.reasoning,
    toolPriceRange,
    pricingReasoning: proposal.reasoning,
    openingOfferRaw: proposal.openingOffer,
    walkAwayCeilingRaw: proposal.walkAwayCeiling,
    openingOffer,
    walkAwayCeiling,
    clamped,
    timestamp: new Date().toISOString(),
  };

  const quote = await callQuote(ask.tool, args, openingOffer);

  return { ok: true, tool: ask.tool, openingOffer, walkAwayCeiling, reasoningRecord, quote };
}
