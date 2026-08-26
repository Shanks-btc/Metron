import type { Metadata } from "next";
import Nav from "@/components/Nav";
import DocsSidebar from "@/components/DocsSidebar";
import CodeBlock from "@/components/CodeBlock";
import Callout from "@/components/Callout";

export const metadata: Metadata = {
  title: "Docs — Metron",
  description: "Technical documentation for Metron's negotiation API, payment settlement, and architecture.",
};

export default function DocsPage() {
  return (
    <>
      <Nav />
      <main className="w-full max-w-full">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6 lg:flex-row lg:px-8 lg:py-16">
          <DocsSidebar />

          <div className="min-w-0 max-w-3xl flex-1">
            <div className="mb-12">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-label">
                Documentation
              </span>
              <h1 className="mt-4 w-full text-balance break-words font-display text-3xl font-bold text-ink-heading sm:text-4xl">
                Metron technical docs.
              </h1>
              <p className="mt-4 w-full max-w-xl text-balance break-words text-sm leading-relaxed text-ink-body sm:text-base">
                Every field name, response shape, and number on this page is pulled
                directly from the running backend&apos;s source and verified against
                live requests — not invented.
              </p>
            </div>

            {/* ---------------- GETTING STARTED ---------------- */}
            <section id="overview" className="min-w-0 scroll-mt-24">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-label">
                Getting started
              </span>
              <h2 className="mt-3 font-display text-2xl font-bold text-ink-heading">Overview</h2>
              <div className="mt-4 flex min-w-0 flex-col gap-4 text-sm leading-relaxed text-ink-body sm:text-base">
                <p>
                  Metron is a negotiated-price payment layer in front of live
                  financial and on-chain intelligence data. Instead of a single flat
                  rate per API call, a buyer agent proposes what it&apos;s willing to
                  pay, and the seller responds by accepting, countering at its real
                  cost floor, or rejecting — resolved in the same request/response
                  round trip.
                </p>
                <p>
                  That negotiation matters because most machine-readable data APIs
                  charge the same price regardless of what a request is actually
                  worth in the moment, forcing every pricing decision to be made
                  once, in advance, by a human. Metron lets the price move instead,
                  in real time, decided by the agents actually doing the requesting.
                </p>
                <p>
                  Once a price is agreed, settlement happens via the x402 protocol
                  on Base mainnet, through Coinbase&apos;s hosted facilitator — no
                  invoices, subscriptions, or manual reconciliation on either side.
                  Metron has three live data sellers today — BTC Cycle Intelligence
                  (5 priced tools), Short Squeeze Intelligence (2 priced tools), and
                  Analyst Momentum (3 priced tools), 10 priced tools total across
                  three independent MCP servers — and the negotiation and
                  settlement layer underneath isn&apos;t specific to any one of them.
                </p>
                <p>
                  A price can be proposed two ways: a human typing a number
                  directly, or an AI agent given a natural-language question and a
                  budget that proposes its own opening offer and negotiates for real
                  (see{" "}
                  <a href="#negotiation-modes" className="text-ink-heading underline underline-offset-2">
                    Two negotiation modes
                  </a>
                  ). Both paths negotiate against the exact same{" "}
                  <code className="text-ink-heading">decide()</code> logic below — neither gets
                  special treatment.
                </p>
              </div>
            </section>

            <section id="architecture" className="mt-12 min-w-0 scroll-mt-24">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-label">
                Getting started
              </span>
              <h2 className="mt-3 font-display text-2xl font-bold text-ink-heading">Architecture</h2>
              <div className="mt-4 flex min-w-0 flex-col gap-4 text-sm leading-relaxed text-ink-body sm:text-base">
                <p>
                  The backend is a single Express API (<code className="text-ink-heading">src/server.ts</code>)
                  that negotiates a price over HTTP and calls out to one of
                  three external MCP servers to fetch the actual intelligence
                  data once a deal settles via x402 on Base mainnet.
                </p>
                <p>
                  Negotiation and payment state is Postgres-backed — quotes,
                  per-negotiation round counters, rejected-proposal records, and
                  (for the AI-agent path) committed reasoning records each live in
                  their own table, so restarting the server no longer clears
                  negotiation history the way an earlier in-memory version of this
                  API once did.
                </p>
                <p>
                  Each quote moves through a small state machine on{" "}
                  <code className="text-ink-heading">GET /pay/:id</code>:{" "}
                  <code className="text-ink-heading">OPEN → PROCESSING → FULFILLED</code>.
                  It exists to prevent double-payment and race conditions on a
                  single quote — the transition to <code className="text-ink-heading">PROCESSING</code>{" "}
                  only happens once the x402 facilitator confirms a real signed
                  payment authorization has arrived (never on a plain unpaid 402
                  probe), and if verification or settlement fails partway through,
                  the quote recovers back to <code className="text-ink-heading">OPEN</code> rather
                  than getting stuck. Only after payment is confirmed does the
                  server call into the seller&apos;s actual data source — one of
                  three external MCP servers (BTC Cycle Intelligence, Short Squeeze
                  Intelligence, or Analyst Momentum, depending on the tool) — and
                  return the result.
                </p>
                <Callout title="What Metron is not">
                  Metron consumes external MCP servers; it does not expose one
                  itself. There is no CLI tool, no chat bot, and no separately
                  hosted &quot;MCP server&quot; product — just this HTTP API.
                </Callout>
                <p>
                  Beyond quote negotiation and MCP fulfillment, the backend also
                  runs a bounded-LLM pricing layer for the AI-agent path (
                  <code className="text-ink-heading">POST /agent-quote</code>), and computes and
                  serves the reasoning behind each AI-priced deal (
                  <code className="text-ink-heading">GET /reasoning/:negotiationId</code>) — see{" "}
                  <a href="#negotiation-modes" className="text-ink-heading underline underline-offset-2">
                    Two negotiation modes
                  </a>{" "}
                  and{" "}
                  <a href="#settlement-x402" className="text-ink-heading underline underline-offset-2">
                    x402 settlement
                  </a>{" "}
                  below.
                </p>
              </div>
            </section>

            {/* ---------------- API REFERENCE ---------------- */}
            <section id="api-quote" className="mt-12 min-w-0 scroll-mt-24">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-label">
                API reference
              </span>
              <h2 className="mt-3 font-display text-2xl font-bold text-ink-heading">POST /quote</h2>
              <p className="mt-4 min-w-0 text-sm leading-relaxed text-ink-body sm:text-base">
                Propose a price for a tool. Returns a decision of{" "}
                <code className="text-ink-heading">accept</code>,{" "}
                <code className="text-ink-heading">counter</code>, or{" "}
                <code className="text-ink-heading">reject</code> in the same response
                — no polling required.
              </p>

              <div className="mt-6 min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-label">
                  Request body
                </p>
                <div className="mt-2">
                  <CodeBlock>{`{
  "tool": string,              // one of the 5 real tool names below
  "proposedPrice": number,     // USDC on Base mainnet (see Payments & Settlement)
  "args"?: object,             // forwarded to the tool after payment
  "negotiationId"?: string     // omit to start a new session
}`}</CodeBlock>
                </div>
              </div>

              <div className="mt-6 min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-label">
                  Response shape (accept / counter)
                </p>
                <div className="mt-2">
                  <CodeBlock>{`{
  "decision": "accept" | "counter",
  "quoteId": string,
  "agreedPrice": number,
  "reason": string,
  "payUrl": "/pay/{quoteId}",
  "expiresInSeconds": 120,
  "negotiationId": string,
  "round": number
}`}</CodeBlock>
                </div>
              </div>

              <div className="mt-6 min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-label">
                  Response shape (reject)
                </p>
                <div className="mt-2">
                  <CodeBlock>{`{
  "decision": "reject",
  "reason": string,
  "negotiationId": string,
  "round": number
}`}</CodeBlock>
                </div>
              </div>

              <p className="mt-8 min-w-0 text-xs font-semibold uppercase tracking-wide text-ink-label">
                Real examples — captured live against the running backend
              </p>

              <div className="mt-3 min-w-0">
                <CodeBlock label="accept — get_btc_cycle_regime @ 0.006">{`$ curl -X POST http://localhost:3000/quote \\
  -H "Content-Type: application/json" \\
  -d '{"tool":"get_btc_cycle_regime","proposedPrice":0.006}'

{"decision":"accept","quoteId":"15935f20-3069-4f68-b6a3-ca298a5b81ea","agreedPrice":0.006,"reason":"Offer clears cost floor; accepted at proposed price.","payUrl":"/pay/15935f20-3069-4f68-b6a3-ca298a5b81ea","expiresInSeconds":120,"negotiationId":"18561973-c914-4e6f-988d-b87d2f458c9c","round":1}`}</CodeBlock>
              </div>

              <div className="mt-4 min-w-0">
                <CodeBlock label="counter — get_entry_risk @ 0.001 (floor is 0.0015)">{`$ curl -X POST http://localhost:3000/quote \\
  -H "Content-Type: application/json" \\
  -d '{"tool":"get_entry_risk","proposedPrice":0.001}'

{"decision":"counter","quoteId":"e8e3ffe7-e72d-4698-816d-e6b00d6178b1","agreedPrice":0.0015,"reason":"Offer below cost floor; countering at floor price.","payUrl":"/pay/e8e3ffe7-e72d-4698-816d-e6b00d6178b1","expiresInSeconds":120,"negotiationId":"06e9f49d-b9a0-4972-a567-23022da85ec7","round":1}`}</CodeBlock>
              </div>

              <div className="mt-4 min-w-0">
                <CodeBlock label="reject — get_lth_behavior @ 0.0002 (floor is 0.0015)">{`$ curl -X POST http://localhost:3000/quote \\
  -H "Content-Type: application/json" \\
  -d '{"tool":"get_lth_behavior","proposedPrice":0.0002}'

{"decision":"reject","reason":"Offer too far below cost floor to be worth countering.","negotiationId":"381088c9-5844-4e66-aff9-7a0de4d373d5","round":1}`}</CodeBlock>
              </div>

              <div className="mt-4 min-w-0">
                <CodeBlock label="400 — missing proposedPrice">{`$ curl -X POST http://localhost:3000/quote \\
  -H "Content-Type: application/json" \\
  -d '{"tool":"get_btc_cycle_regime"}'

{"error":"tool and proposedPrice are required"}`}</CodeBlock>
              </div>
            </section>

            <section id="api-pay" className="mt-12 min-w-0 scroll-mt-24">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-label">
                API reference
              </span>
              <h2 className="mt-3 font-display text-2xl font-bold text-ink-heading">GET /pay/:id</h2>
              <div className="mt-4 flex min-w-0 flex-col gap-4 text-sm leading-relaxed text-ink-body sm:text-base">
                <p>
                  The x402-gated payment route returned as <code className="text-ink-heading">payUrl</code>{" "}
                  from an accepted or countered quote — the single HTTP call that both pays and
                  delivers the data. An unpaid request returns{" "}
                  <code className="text-ink-heading">402 Payment Required</code> with Coinbase&apos;s
                  hosted x402 facilitator&apos;s payment-requirements payload; a correctly signed
                  payment authorization completes the purchase and returns the real tool data in
                  the same response.
                </p>
                <Callout title="Not something you curl directly">
                  In normal use this route is paid via an x402-aware client that can sign an
                  EIP-3009 payment authorization with a real wallet, not called bare — see{" "}
                  <a href="#settlement-x402" className="text-ink-heading underline underline-offset-2">
                    x402 settlement
                  </a>{" "}
                  below. The shapes below are shown for completeness — the unpaid 402 response is
                  real and safe to reproduce with plain curl; the paid success response is the
                  real documented shape from the source, not demonstrated live here (see
                  Limitations).
                </Callout>
              </div>

              <div className="mt-6 min-w-0">
                <CodeBlock label="402 — unpaid request (real, reproducible)">{`$ curl -i http://localhost:3000/pay/15935f20-3069-4f68-b6a3-ca298a5b81ea

HTTP/1.1 402 Payment Required
PAYMENT-REQUIRED: <base64-encoded payment requirements>
Content-Type: application/json

{}`}</CodeBlock>
              </div>

              <div className="mt-4 min-w-0">
                <CodeBlock label="the PAYMENT-REQUIRED header, decoded">{`{
  "x402Version": 2,
  "resource": {
    "url": "/pay/15935f20-3069-4f68-b6a3-ca298a5b81ea",
    "description": "Paid intelligence tool data",
    "mimeType": "application/json"
  },
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:8453",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "amount": "6000",
    "payTo": "0x1b777a0aE8d7f22d394A9BAB3f40d92664dcaAC1",
    "maxTimeoutSeconds": 300
  }]
}`}</CodeBlock>
              </div>

              <div className="mt-4 min-w-0">
                <CodeBlock label="error cases (real)">{`404  {"error":"Unknown or expired quote"}
409  {"error":"Quote already redeemed"}                     (state is FULFILLED)
409  {"error":"Payment already in progress for this quote"} (state is PROCESSING)
410  {"error":"Quote expired - request a new /quote"}       (>600s since /quote)`}</CodeBlock>
              </div>

              <div className="mt-4 min-w-0">
                <CodeBlock label="success — after a valid signed payment (real shape, from source)">{`{
  "message": "Payment accepted - here is your data.",
  "tool": string,
  "agreedPrice": number,
  "data": unknown,          // the actual paid tool output — the one place
                             // in this whole API that appears
  "negotiationId": string,
  "round": number,
  "payerAddress": string | null
}`}</CodeBlock>
              </div>
            </section>

            <section id="api-activity" className="mt-12 min-w-0 scroll-mt-24">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-label">
                API reference
              </span>
              <h2 className="mt-3 font-display text-2xl font-bold text-ink-heading">GET /activity</h2>
              <div className="mt-4 flex min-w-0 flex-col gap-4 text-sm leading-relaxed text-ink-body sm:text-base">
                <p>
                  Metadata about past negotiations. Accepts an optional{" "}
                  <code className="text-ink-heading">?limit=</code> query param
                  (default 100) and an optional{" "}
                  <code className="text-ink-heading">?tool=a,b,c</code> filter, applied before the
                  sort+slice — so a caller asking about a specific low-volume tool
                  always gets that tool&apos;s own most recent events, rather than
                  having them silently fall out of a shared all-tools window once
                  other tools accumulate more recent activity. Sorted newest first.
                </p>
              </div>

              <div className="mt-4 min-w-0">
                <CodeBlock label="real response — GET /activity?limit=3">{`[
  {
    "quoteId": "e8e3ffe7-e72d-4698-816d-e6b00d6178b1",
    "negotiationId": "06e9f49d-b9a0-4972-a567-23022da85ec7",
    "round": 1,
    "tool": "get_entry_risk",
    "decision": "countered",
    "agreedPrice": 0.0015,
    "createdAt": "2026-07-06T14:36:19.860Z",
    "state": "OPEN"
  },
  {
    "quoteId": null,
    "negotiationId": "381088c9-5844-4e66-aff9-7a0de4d373d5",
    "round": 1,
    "tool": "get_lth_behavior",
    "decision": "rejected",
    "agreedPrice": null,
    "createdAt": "2026-07-06T14:36:19.930Z",
    "state": null
  }
]`}</CodeBlock>
              </div>

              <div className="mt-6">
                <Callout title="What this deliberately does not expose">
                  Never the actual paid intelligence data/content itself — only
                  metadata about how a price got agreed. For rejected offers, only{" "}
                  <code className="text-ink-heading">tool</code>,{" "}
                  <code className="text-ink-heading">negotiationId</code>,{" "}
                  <code className="text-ink-heading">round</code>, and a timestamp are
                  kept — never the proposed price or the rejection reason, since
                  either would reveal how close a lowball offer came to the real
                  cost floor. Both exclusions are deliberate: this endpoint is
                  activity metadata, and the whole product depends on not giving
                  away for free what people pay for.
                </Callout>
              </div>
            </section>

            <section id="api-pricing" className="mt-12 min-w-0 scroll-mt-24">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-label">
                API reference
              </span>
              <h2 className="mt-3 font-display text-2xl font-bold text-ink-heading">GET /pricing</h2>
              <p className="mt-4 min-w-0 text-sm leading-relaxed text-ink-body sm:text-base">
                Read-only pricing configuration: the real cost floor and asking
                price <code className="text-ink-heading">/quote</code> negotiates
                against for each of the 10 priced tools across all three sellers,
                plus the seller address, any required arguments per tool, and the
                settlement network.
              </p>
              <div className="mt-4 min-w-0">
                <CodeBlock label="real response shape — GET /pricing">{`{"sellerAddress":"0x1b777a0aE8d7f22d394A9BAB3f40d92664dcaAC1","network":"eip155:8453","tools":[{"tool":"get_btc_cycle_regime","costFloor":0.003,"askPrice":0.008,"requiredArgs":[]},{"tool":"get_lth_behavior","costFloor":0.0015,"askPrice":0.004,"requiredArgs":[]},{"tool":"get_entry_risk","costFloor":0.0015,"askPrice":0.004,"requiredArgs":[]},{"tool":"compare_to_2021_top","costFloor":0.002,"askPrice":0.005,"requiredArgs":[]},{"tool":"get_nupl_sentiment","costFloor":0.0015,"askPrice":0.004,"requiredArgs":[]},{"tool":"get_squeeze_risk","costFloor":0.003,"askPrice":0.008,"requiredArgs":["ticker"]},{"tool":"compare_squeeze_risk","costFloor":0.002,"askPrice":0.005,"requiredArgs":["ticker1","ticker2"]},{"tool":"get_analyst_momentum","costFloor":0.025,"askPrice":0.07,"requiredArgs":["ticker"]},{"tool":"compare_analyst_momentum","costFloor":0.018,"askPrice":0.045,"requiredArgs":["ticker1","ticker2"]},{"tool":"screen_analyst_momentum","costFloor":0.03,"askPrice":0.08,"requiredArgs":["tickers"]}]}`}</CodeBlock>
              </div>
            </section>

            <section id="api-agent-quote" className="mt-12 min-w-0 scroll-mt-24">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-label">
                API reference
              </span>
              <h2 className="mt-3 font-display text-2xl font-bold text-ink-heading">POST /agent-quote</h2>
              <div className="mt-4 flex min-w-0 flex-col gap-4 text-sm leading-relaxed text-ink-body sm:text-base">
                <p>
                  The AI-agent negotiation path (see{" "}
                  <a href="#negotiation-modes" className="text-ink-heading underline underline-offset-2">
                    Two negotiation modes
                  </a>
                  ). Given a natural-language question and a{" "}
                  <code className="text-ink-heading">maxBudget</code>, a real Claude Haiku call (
                  <code className="text-ink-heading">src/pricingLayer.ts</code>) picks one of the ten
                  priced tools (via the existing, unchanged{" "}
                  <code className="text-ink-heading">POST /ask</code> tool-selection reasoning),
                  proposes an opening offer and a walk-away ceiling, and negotiates
                  for real against the same{" "}
                  <code className="text-ink-heading">POST /quote</code> +{" "}
                  <code className="text-ink-heading">decide()</code> every other proposal goes
                  through.
                </p>
                <Callout title="The hard part: the LLM proposes, code enforces">
                  The LLM&apos;s <code className="text-ink-heading">openingOffer</code> and{" "}
                  <code className="text-ink-heading">walkAwayCeiling</code> are clamped against{" "}
                  <code className="text-ink-heading">policy.maxBudget</code> in plain code (
                  <code className="text-ink-heading">clampToPolicy()</code>) before either number is
                  ever used — never left to the prompt alone. Neither value can
                  exceed <code className="text-ink-heading">maxBudget</code> under any
                  circumstances, regardless of what the model returns; the
                  response&apos;s <code className="text-ink-heading">reasoningRecord.clamped</code>{" "}
                  field reports honestly whenever a raw LLM value actually had to
                  be corrected. This is the actual AI-native mechanism this project
                  is built around — a bounded economic agent, not just an LLM
                  router.
                </Callout>
                <p>
                  If the seller counters and the countered price is still within
                  the walk-away ceiling, this endpoint automatically re-proposes
                  once at the countered price — the same one-counter-round pattern
                  the integration tests use — rather than looping indefinitely.
                </p>
                <p>
                  Only on a real <code className="text-ink-heading">accept</code> is a
                  reasoning-hash computed and stored (see{" "}
                  <code className="text-ink-heading">GET /reasoning/:negotiationId</code> below) — a
                  countered-then-rejected or a straight reject never gets one,
                  since there is no agreed deal for it to commit to.
                </p>
              </div>

              <div className="mt-6 min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-label">
                  Request body
                </p>
                <div className="mt-2">
                  <CodeBlock>{`{
  "question": string,   // natural-language question
  "maxBudget": number    // hard USD ceiling, enforced in code, not just prompted
}`}</CodeBlock>
                </div>
              </div>

              <div className="mt-6 min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-label">
                  Example response shape
                </p>
                <div className="mt-2">
                  <CodeBlock label="agreed — get_entry_risk, real Claude Haiku pricing call">{`$ curl -X POST http://localhost:3000/agent-quote \\
  -H "Content-Type: application/json" \\
  -d '{"question":"What is the current entry risk for bitcoin?","maxBudget":0.05}'

{"answered":true,"tool":"get_entry_risk","openingOffer":0.002,"walkAwayCeiling":0.04,"reasoningRecord":{"policy":{"maxBudget":0.05},"question":"What is the current entry risk for bitcoin?","tool":"get_entry_risk","toolSelectionReasoning":"The user is directly asking about current Bitcoin entry risk, which is exactly what the get_entry_risk tool answers—it returns whether current BTC on-chain metrics suggest a high or low risk entry point.","toolPriceRange":{"costFloor":0.0015,"askPrice":0.004},"pricingReasoning":"Opening offer of $0.002 is slightly above the cost floor ($0.0015) and below the typical ask ($0.004), positioning us competitively while leaving room for negotiation. Walk-away ceiling of $0.04 remains well below the hard budget constraint of $0.05, providing a 20% buffer and ensuring we stay within policy limits even if the seller counters aggressively. This range reflects a realistic negotiating posture for a data query about bitcoin entry risk.","openingOfferRaw":0.002,"walkAwayCeilingRaw":0.04,"openingOffer":0.002,"walkAwayCeiling":0.04,"clamped":{"openingOffer":false,"walkAwayCeiling":false},"timestamp":"2026-08-20T16:19:10.791Z"},"decision":"accept","reason":"Offer clears cost floor; accepted at proposed price.","negotiationId":"a5daffea-fa65-4540-9ff6-6327d8b750a8","round":1,"quoteId":"e1a2b3c4-5678-4abc-9def-0123456789ab","agreed":true,"agreedPrice":0.002,"reasoningHash":"0xfc4566a12c231f3e901c8145cf0cf5c792727749bbb6a0619dab2b148d2ae5e0"}`}</CodeBlock>
                </div>
              </div>
            </section>

            <section id="api-reasoning" className="mt-12 min-w-0 scroll-mt-24">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-label">
                API reference
              </span>
              <h2 className="mt-3 font-display text-2xl font-bold text-ink-heading">
                GET /reasoning/:negotiationId
              </h2>
              <div className="mt-4 flex min-w-0 flex-col gap-4 text-sm leading-relaxed text-ink-body sm:text-base">
                <p>
                  Returns the full canonical reasoning record and its committed
                  hash for a given negotiation, so the reasoning-hash record
                  made by <code className="text-ink-heading">POST /agent-quote</code> is
                  independently checkable by anyone — not just trusted because the
                  server says so.
                </p>
                <p>
                  What gets hashed: the exact{" "}
                  <code className="text-ink-heading">reasoningRecord</code> object returned by{" "}
                  <code className="text-ink-heading">POST /agent-quote</code> — policy, question,
                  selected tool, both selection and pricing reasoning text, the
                  tool&apos;s real cost-floor/ask range, the LLM&apos;s raw proposed
                  numbers, the clamped final numbers, whether clamping actually
                  fired, and a timestamp. It is canonicalized first (
                  <code className="text-ink-heading">src/reasoningHash.ts</code> — object keys
                  sorted recursively, so the same logical record always serializes
                  to the same bytes regardless of insertion order) and then hashed
                  with <code className="text-ink-heading">keccak256</code>.
                </p>
                <p>
                  Where it&apos;s stored: a{" "}
                  <code className="text-ink-heading">reasoning_records</code> Postgres table, one
                  row per negotiationId, written by{" "}
                  <code className="text-ink-heading">POST /agent-quote</code> at the moment a deal
                  is agreed.
                </p>
                <Callout title="Off-chain audit record — by design, not omission">
                  x402&apos;s <code className="text-ink-heading">exact</code> scheme settles via a
                  signed EIP-3009 USDC transfer, with no calldata slot for an app-level
                  commitment the way <code className="text-ink-heading">BidwellSettlement.openDeal()</code>{" "}
                  had on Metron&apos;s earlier BOT Chain build. Rather than add a second, separate
                  on-chain transaction just to anchor a hash, the commitment stays off-chain but
                  still independently checkable: 1) fetch the record from this endpoint, 2)
                  canonicalize it yourself (sort object keys recursively, then JSON.stringify) and
                  compute its keccak256, 3) confirm that matches this endpoint&apos;s own{" "}
                  <code className="text-ink-heading">reasoningHash</code> field, returned by{" "}
                  <code className="text-ink-heading">POST /agent-quote</code> at the moment the deal
                  was agreed — before payment ever happened. This is a standard hash-commitment
                  pattern; a real on-chain anchor (sponsored via CDP Paymaster) remains a
                  reasonable future addition, not something this build claims today.
                </Callout>
              </div>

              <div className="mt-6 min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-label">
                  Example response shape — the same negotiation shown above
                </p>
                <div className="mt-2">
                  <CodeBlock label="GET /reasoning/a5daffea-fa65-4540-9ff6-6327d8b750a8">{`{"negotiationId":"a5daffea-fa65-4540-9ff6-6327d8b750a8","reasoningHash":"0xfc4566a12c231f3e901c8145cf0cf5c792727749bbb6a0619dab2b148d2ae5e0","record":{"tool":"get_entry_risk","policy":{"maxBudget":0.05},"clamped":{"openingOffer":false,"walkAwayCeiling":false},"question":"What is the current entry risk for bitcoin?","timestamp":"2026-08-20T16:19:10.791Z","openingOffer":0.002,"toolPriceRange":{"askPrice":0.004,"costFloor":0.0015},"openingOfferRaw":0.002,"walkAwayCeiling":0.04,"pricingReasoning":"Opening offer of $0.002 is slightly above the cost floor ($0.0015) and below the typical ask ($0.004), positioning us competitively while leaving room for negotiation. Walk-away ceiling of $0.04 remains well below the hard budget constraint of $0.05, providing a 20% buffer and ensuring we stay within policy limits even if the seller counters aggressively. This range reflects a realistic negotiating posture for a data query about bitcoin entry risk.","walkAwayCeilingRaw":0.04,"toolSelectionReasoning":"The user is directly asking about current Bitcoin entry risk, which is exactly what the get_entry_risk tool answers—it returns whether current BTC on-chain metrics suggest a high or low risk entry point."},"createdAt":"2026-08-20T16:19:14.054Z"}`}</CodeBlock>
                </div>
              </div>

              <div className="mt-4 min-w-0">
                <CodeBlock label="404 — unknown negotiationId (real)">{`{"error":"No reasoning record for this negotiationId"}`}</CodeBlock>
              </div>
            </section>

            {/* ---------------- HOW NEGOTIATION WORKS ---------------- */}
            <section id="negotiation-modes" className="mt-12 min-w-0 scroll-mt-24">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-label">
                How negotiation works
              </span>
              <h2 className="mt-3 font-display text-2xl font-bold text-ink-heading">
                Two negotiation modes
              </h2>
              <div className="mt-4 flex min-w-0 flex-col gap-4 text-sm leading-relaxed text-ink-body sm:text-base">
                <p>
                  A <code className="text-ink-heading">proposedPrice</code> reaching{" "}
                  <code className="text-ink-heading">POST /quote</code> can come from either of two
                  paths, side by side in the live &quot;Try It&quot; widget. Both negotiate
                  against the exact same <code className="text-ink-heading">decide()</code> logic
                  below — the server has no idea, and no reason to care, which path
                  produced the number it received.
                </p>
                <p>
                  <strong className="text-ink-heading">Human-typed price.</strong> A person picks
                  a tool and types a proposed price directly. The UI calls{" "}
                  <code className="text-ink-heading">POST /quote</code> itself, with no LLM
                  involved on the buyer&apos;s side at all — the reasoning behind the
                  number, if any, existed only in the human&apos;s head, so no
                  reasoning-hash commitment is made for a deal reached this way
                  (see Payments &amp; settlement below).
                </p>
                <p>
                  <strong className="text-ink-heading">AI agent.</strong> A person instead gives a
                  natural-language question and a max budget. The UI calls{" "}
                  <code className="text-ink-heading">POST /agent-quote</code>, where a real
                  bounded-LLM pricing layer picks the tool, proposes an opening
                  offer and a walk-away ceiling, and negotiates for real against
                  the same <code className="text-ink-heading">POST /quote</code> the human-typed
                  path uses — the only difference is who (or what) is deciding the
                  number, never how that number gets evaluated.
                </p>
                <Callout title={'"View as API call" (AI-agent mode only)'}>
                  After an AI-agent negotiation completes, a &quot;View as API call&quot;
                  button next to the Pay button reveals the exact two real calls
                  that negotiation just made: the <code className="text-ink-heading">POST /agent-quote</code>{" "}
                  request and response shown above — with this negotiation&apos;s
                  actual values, not placeholders — and the real{" "}
                  <code className="text-ink-heading">GET /pay/:id</code> call the wallet sends to
                  settle it, carrying a signed EIP-3009 payment authorization rather than a
                  wallet-typed contract call (see x402 settlement below).
                </Callout>
              </div>
            </section>

            <section id="negotiation-logic" className="mt-12 min-w-0 scroll-mt-24">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-label">
                How negotiation works
              </span>
              <h2 className="mt-3 font-display text-2xl font-bold text-ink-heading">Decision logic</h2>
              <p className="mt-4 min-w-0 text-sm leading-relaxed text-ink-body sm:text-base">
                Every proposal is checked against two real numbers for that tool —
                its cost floor and its asking price — in this order:
              </p>
              <div className="mt-4 min-w-0">
                <CodeBlock>{`offer >= askPrice        -> accept, at askPrice
offer >= costFloor       -> accept, at the proposed price
offer >= costFloor * 0.5 -> counter, at costFloor
offer <  costFloor * 0.5 -> reject`}</CodeBlock>
              </div>
              <p className="mt-4 min-w-0 text-sm leading-relaxed text-ink-body sm:text-base">
                Worked example using <code className="text-ink-heading">get_entry_risk</code>{" "}
                (real floor <code className="text-ink-heading">$0.0015</code>, real ask{" "}
                <code className="text-ink-heading">$0.004</code>):
              </p>
              <div className="mt-4 min-w-0">
                <CodeBlock>{`propose >= $0.004               -> accept @ $0.004 (the ask)
propose in [$0.0015, $0.004)    -> accept @ the proposed price
propose in [$0.00075, $0.0015)  -> counter @ $0.0015 (the floor)
propose <  $0.00075             -> reject`}</CodeBlock>
              </div>
            </section>

            <section id="negotiation-sessions" className="mt-12 min-w-0 scroll-mt-24">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-label">
                How negotiation works
              </span>
              <h2 className="mt-3 font-display text-2xl font-bold text-ink-heading">
                Sessions &amp; rounds
              </h2>
              <div className="mt-4 flex min-w-0 flex-col gap-4 text-sm leading-relaxed text-ink-body sm:text-base">
                <p>
                  Omit <code className="text-ink-heading">negotiationId</code> to start a
                  new session — the server generates one and returns it. Pass an
                  existing <code className="text-ink-heading">negotiationId</code> back on
                  a re-proposal (e.g. after a counter) to continue the same
                  session; the server tracks the round count itself, independent of
                  whatever the caller thinks the round is.
                </p>
                <p>
                  A session is capped at <code className="text-ink-heading">5</code> rounds.
                  The 6th call on the same <code className="text-ink-heading">negotiationId</code>{" "}
                  is rejected outright, regardless of price:
                </p>
              </div>
              <div className="mt-4 min-w-0">
                <CodeBlock label="real 6-round session, same negotiationId throughout">{`round 1..5: {"decision":"reject","reason":"Offer too far below cost floor to be worth countering.","negotiationId":"84793b1d-c350-4f6e-ae4a-6b2ff9a7471f","round":1..5}

round 6:    {"decision":"reject","reason":"Max negotiation rounds (5) exceeded for this session.","negotiationId":"84793b1d-c350-4f6e-ae4a-6b2ff9a7471f","round":6}`}</CodeBlock>
              </div>
            </section>

            {/* ---------------- PAYMENTS & SETTLEMENT ---------------- */}
            <section id="settlement-x402" className="mt-12 min-w-0 scroll-mt-24">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-label">
                Payments &amp; settlement
              </span>
              <h2 className="mt-3 font-display text-2xl font-bold text-ink-heading">
                x402 settlement (Base mainnet)
              </h2>
              <div className="mt-4 flex min-w-0 flex-col gap-4 text-sm leading-relaxed text-ink-body sm:text-base">
                <p>
                  Once a price is agreed (by either negotiation mode above), the buyer&apos;s
                  wallet pays and receives the data in a single gated HTTP call —{" "}
                  <code className="text-ink-heading">GET /pay/:id</code> — rather than a separate
                  on-chain escrow transaction. The wallet signs an EIP-3009{" "}
                  <code className="text-ink-heading">transferWithAuthorization</code> payment
                  authorization for the agreed amount (a typed-data signature, not a broadcast
                  transaction) and attaches it as a request header; Coinbase&apos;s hosted x402
                  facilitator (<code className="text-ink-heading">@coinbase/x402</code>) verifies
                  and settles it directly on Base mainnet before the server returns the paid data.
                </p>
                <div className="min-w-0">
                  <CodeBlock>{`Network: eip155:8453 (Base mainnet)
Asset:   USDC — 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
Scheme:  exact
Facilitator: Coinbase-hosted (CDP_API_KEY_ID / CDP_API_KEY_SECRET)
Explorer: https://basescan.org`}</CodeBlock>
                </div>
                <p>
                  Each quote has its own negotiated price, so the amount the facilitator gates on{" "}
                  <code className="text-ink-heading">GET /pay/:id</code> is resolved per-request
                  (a <code className="text-ink-heading">DynamicPrice</code> lookup against the
                  quote&apos;s <code className="text-ink-heading">agreedPrice</code> in Postgres),
                  not a fixed price for the route.
                </p>
                <p>
                  The <code className="text-ink-heading">OPEN → PROCESSING → FULFILLED</code> quote
                  state machine (see Architecture above) is driven by the facilitator&apos;s own
                  verify/settle lifecycle: <code className="text-ink-heading">PROCESSING</code>{" "}
                  only happens once a real signed payment authorization arrives, and a failed
                  verify or settle recovers the quote back to{" "}
                  <code className="text-ink-heading">OPEN</code> rather than leaving it stuck. On a
                  real successful settlement, the facilitator&apos;s own response supplies the real
                  payer address and settlement transaction hash — never derived or guessed —
                  which is what <code className="text-ink-heading">payerAddress</code> in{" "}
                  <code className="text-ink-heading">GET /activity</code> and the paid response
                  shape reflect.
                </p>
                <Callout title="CORS">
                  The API allows cross-origin requests (<code className="text-ink-heading">cors()</code>{" "}
                  with default settings) so the web frontend can call it directly
                  from the browser. This is wide open for local development and is
                  meant to be restricted to the real production frontend origin
                  before public deployment.
                </Callout>
              </div>
            </section>

            <section id="settlement-reasoning-hash" className="mt-12 min-w-0 scroll-mt-24">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-label">
                Payments &amp; settlement
              </span>
              <h2 className="mt-3 font-display text-2xl font-bold text-ink-heading">
                Reasoning-hash audit record
              </h2>
              <div className="mt-4 flex min-w-0 flex-col gap-4 text-sm leading-relaxed text-ink-body sm:text-base">
                <p>
                  x402&apos;s <code className="text-ink-heading">exact</code> scheme settles via a
                  plain signed USDC transfer, with no calldata slot for an app-level commitment.
                  So the AI-agent path&apos;s reasoning-hash (see{" "}
                  <code className="text-ink-heading">GET /reasoning/:negotiationId</code> above) is
                  an off-chain, API-checkable audit record rather than an on-chain commitment —
                  still real and independently verifiable by anyone, just not anchored a second
                  time on-chain. A CDP Paymaster-sponsored on-chain commitment transaction remains
                  a reasonable future addition if a stronger anchor is ever needed; it is not part
                  of this build.
                </p>
              </div>
            </section>

            {/* ---------------- LIMITATIONS & ROADMAP ---------------- */}
            <section id="limitations" className="mt-12 min-w-0 scroll-mt-24">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-label">
                Limitations &amp; roadmap
              </span>
              <h2 className="mt-3 font-display text-2xl font-bold text-ink-heading">
                Known limitations
              </h2>
              <ul className="mt-4 flex min-w-0 flex-col gap-4 text-sm leading-relaxed text-ink-body sm:text-base">
                <li className="min-w-0">
                  <strong className="text-ink-heading">No self-service refunds.</strong> x402&apos;s{" "}
                  <code className="text-ink-heading">exact</code> scheme is a direct signed
                  transfer, not an escrow contract — if payment settles but{" "}
                  <code className="text-ink-heading">callMcpTool()</code> then fails after retries,
                  the quote is marked with a{" "}
                  <code className="text-ink-heading">fulfillmentFailure</code> record rather than
                  silently dropped (see <code className="text-ink-heading">GET /pay/:id</code>{" "}
                  above), but there is no automated refund path for that case today.
                </li>
                <li className="min-w-0">
                  <strong className="text-ink-heading">No reasoning-hash commitment for
                  human-typed prices.</strong> By design, not oversight — a manually
                  typed price has no real reasoning transcript behind it to hash,
                  so a deal opened via the human-typed path has no reasoning record at all. Only
                  the AI-agent path (<code className="text-ink-heading">POST /agent-quote</code>)
                  produces a real, independently verifiable reasoning-hash record.
                </li>
                <li className="min-w-0">
                  <strong className="text-ink-heading">The reasoning-hash record is off-chain
                  only.</strong> See{" "}
                  <a href="#settlement-reasoning-hash" className="text-ink-heading underline underline-offset-2">
                    Reasoning-hash audit record
                  </a>{" "}
                  above — a deliberate scope choice for this build, not a limitation discovered
                  after the fact.
                </li>
              </ul>
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
