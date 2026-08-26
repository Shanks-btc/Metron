# Metron

**Machines that negotiate their own data prices, settled via x402 on Base.**

Metron is a negotiation and settlement layer for live financial and on-chain intelligence. Buyer agents propose a price, providers accept, counter at their real cost floor, or reject  and once a price is agreed, payment settles through the x402 protocol on Base mainnet via Coinbase's hosted facilitator, with delivery and settlement happening in a single HTTP call, with zero manual intervention.

---

## Table of contents

- [What Metron does](#what-metron-does)
- [Why this exists — the problem](#why-this-exists--the-problem)
- [How it works](#how-it-works)
- [AI-native pricing](#ai-native-pricing)
- [Reasoning-hash audit record](#reasoning-hash-audit-record)
- [Architecture](#architecture)
- [Why x402 on Base](#why-x402-on-base)
- [Origin — migrated from Bidwell (BOT Chain) and Valiquo (Arc Testnet)](#origin--migrated-from-bidwell-bot-chain-and-valiquo-arc-testnet)
- [Tech stack](#tech-stack)
- [Local development](#local-development)
- [API reference](#api-reference)
- [Project structure](#project-structure)
- [Known limitations](#known-limitations)
- [Roadmap](#roadmap)
- [Team](#team)

---

## What Metron does

Most machine-readable data APIs charge a single flat price per call, regardless of what a given request is actually worth, overcharging low-value queries and underpricing high-value ones, with no way for either side to signal what they're willing to pay or accept.

Metron lets AI agents negotiate their own data prices in real time, for live financial and on-chain intelligence, BTC cycle regime data, short-squeeze risk, and analyst momentum signals and settles every agreed price directly on Base mainnet via x402.

## Why this exists - the problem

Real-time financial and on-chain intelligence, the kind Bloomberg Terminal, Glassnode, and Nansen charge thousands a month for, is out of reach for most AI agents and independent traders. Cost isn't the only problem: even affordable APIs typically charge one flat rate per call, which overprices simple requests and underprices premium ones, and gives neither side a way to signal what a request is actually worth.

Metron replaces the flat-price model with real negotiation, and settles through x402 — an open, HTTP-native payment protocol built for exactly this: machine-to-machine micropayments gated by a standard `402 Payment Required` response, verified and settled by a facilitator rather than a bespoke payment integration per API.

## How it works

1. **Propose** - A buyer agent sends a proposed price for a data tool (BTC Cycle Regime, Entry Risk, LTH Behavior, NUPL Sentiment, Squeeze Risk, Analyst Momentum, and others) to Metron's `/quote` endpoint.
2. **Negotiate** - The seller's deterministic pricing engine accepts outright, counters at its real cost floor with a reason, or rejects — bounded to a few rounds per session.
3. **Settle** - Once a price is agreed, the buyer's wallet signs an EIP-3009 payment authorization and sends it as a header on `GET /pay/:id`. Coinbase's hosted x402 facilitator verifies and settles the payment directly on Base mainnet — no separate escrow contract, no on-chain transaction from the buyer's side at all.
4. **Deliver** - Once the facilitator confirms settlement, the same request returns the real intelligence data — payment and delivery happen in a single round trip, with no human in the loop.
5. **Verify** - Every settlement's real payer address and transaction hash come from the facilitator's own settle response, checkable independently on [Basescan](https://basescan.org).

## AI-native pricing

Metron has two negotiation modes:

- **Human-typed price** - a person proposes the price directly.
- **AI agent** - a bounded LLM is given a natural-language question and a policy (max budget, acceptable price range). It selects the right tool, reasons about the market price, and proposes both an **opening offer** and a **walk-away ceiling** — a genuine economic decision, not text generation for a human to act on afterward.

The AI's proposed values are then **hard-clamped in code**, not just by prompt: the opening offer and walk-away ceiling can never exceed the caller's stated `maxBudget`, regardless of what the model reasons toward. This is proven by a deterministic unit test (`clampToPolicy()`), independent of any live model behavior, so the budget guarantee holds even in cases live testing never happened to exercise.

A separate, unchanged, deterministic engine (`decide()`) still makes the actual accept/counter/reject decision — the AI sets *what to offer*, the deterministic engine decides *what to accept*. This split keeps the negotiation auditable and reproducible while still making AI a genuine economic actor, not decoration.

## Reasoning-hash audit record

Every AI-agent negotiation's full reasoning — the policy used, the model's stated reasoning, the opening offer, whether clamping occurred — is canonically serialized and hashed (`keccak256`) at the moment a deal is agreed, and served from `GET /reasoning/:negotiationId`.

Anyone can independently:
1. Fetch the stored reasoning JSON.
2. Recompute its hash.
3. Confirm it matches the `reasoningHash` this API returned when the deal was made.

This is deliberately an **off-chain, API-checkable audit record** rather than an on-chain commitment: x402's `exact` scheme settles via a plain signed USDC transfer, with no calldata slot for an app-level commitment. A CDP Paymaster-sponsored on-chain commitment transaction remains a reasonable future addition if a stronger anchor is ever needed — it is not part of this build today.

## Architecture

```
Buyer  →  POST /quote  { tool, args, proposedPrice }
       ←  { decision: accept | counter | reject, agreedPrice, negotiationId, quoteId, payUrl }

  [if AI-agent mode: a bounded LLM sets proposedPrice within a hard-coded
   maxBudget clamp, before this same flow runs]

Buyer  →  GET /pay/:id, with a signed EIP-3009 payment authorization header
       →  Coinbase's hosted x402 facilitator verifies + settles on Base mainnet
       →  callMcpTool(tool, args)  →  real intelligence data returned
       ←  { message, tool, agreedPrice, data, negotiationId, round, payerAddress }

Anyone →  GET /reasoning/:negotiationId
       →  recompute keccak256(reasoningRecord)
       →  compare against this endpoint's own stored reasoningHash
       →  independently confirm the AI's stated reasoning matches what was agreed
```

**Backend (`src/server.ts`)** — a single Express API. `@x402/express` v2's `paymentMiddleware`, backed by `@x402/core`'s `x402ResourceServer` and Coinbase's hosted facilitator (`@coinbase/x402`), gates `GET /pay/:id`. Each quote's price is resolved per-request (a `DynamicPrice` lookup against the negotiated `agreedPrice` in Postgres), since every quote has its own price rather than a fixed per-route amount. The existing `OPEN → PROCESSING → FULFILLED` quote state machine is preserved, now driven by the facilitator's verify/settle lifecycle hooks instead of a bespoke gateway integration.

**Bounded-LLM pricing layer (`src/pricingLayer.ts`)** — sits above the unchanged deterministic negotiation engine. Sets the opening offer and walk-away ceiling per-request, clamped in code to a hard budget. Unchanged from the prior build.

**Frontend payment (`web/src/lib/payX402.ts`)** — the browser wallet signs the EIP-3009 payment authorization via `@x402/fetch`'s `wrapFetchWithPayment`, wrapping the same injected-wallet viem `WalletClient` pattern used previously, adapted to x402's minimal `ClientEvmSigner` interface.

## Why x402 on Base

**Standard, not bespoke:** x402 is an open HTTP payment protocol with a real facilitator ecosystem — using Coinbase's hosted facilitator means Metron doesn't have to run its own settlement infrastructure or trust model, unlike a self-facilitated custom escrow contract.

**Real USDC, real liquidity:** Base mainnet USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) is Circle-issued, not a bridged or wrapped stand-in — this backend's real sub-cent prices ($0.0015–$0.08) settle in an asset with genuine liquidity and no provenance caveats.

**Fast, cheap finality:** Base's low fees and fast finality suit high-frequency, sub-cent agent-to-agent payments better than a chain where gas alone would exceed the price of the data being purchased.

## Origin — migrated from Bidwell (BOT Chain) and Valiquo (Arc Testnet)

Metron is a rebuild of an earlier product, **Bidwell**, which itself was a rebuild of **Valiquo** (originally on Arc Testnet via Circle Gateway, then migrated to a self-facilitated escrow contract on BOT Chain). Both of those settlement layers have been fully removed in this build, replaced with x402 on Base:

**What carried over unchanged:** the deterministic negotiation engine (`decide()`), the multi-seller tool catalog, the natural-language tool-selection router, the Postgres-backed negotiation state machine, the bounded-LLM pricing layer.

**What was removed:** `BidwellSettlement.sol` and its BOT Chain wiring (`settlementBot.ts`, `fulfillmentListener.ts`, the browser wallet's direct contract calls), the legacy Circle Gateway/Arc Testnet payment gate (`@circle-fin/x402-batching`, `settlementLog.ts`, `ValiquoSettlementLog.sol`), and the entire Hardhat/Solidity toolchain — there is no smart contract in this build at all.

**What was rebuilt for x402/Base:**
1. A real `@x402/express` v2 payment gate on `GET /pay/:id`, backed by Coinbase's hosted facilitator.
2. A browser-wallet x402 payment flow (`web/src/lib/payX402.ts`) using EIP-3009 signed authorizations instead of on-chain contract calls.
3. The reasoning-hash mechanism, now an off-chain audit record rather than an on-chain commitment (see above).

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express, TypeScript |
| Frontend | Next.js 14, React, TypeScript, Tailwind CSS |
| Database | PostgreSQL |
| Payments | x402 protocol v2 (`@x402/core`, `@x402/evm`, `@x402/express`, `@x402/fetch`), Coinbase-hosted facilitator (`@coinbase/x402`) |
| Blockchain client | viem |
| AI | Anthropic SDK, Claude Haiku 4.5 |
| Chain | Base mainnet (`eip155:8453`), EVM-compatible |

## Local development

### Prerequisites
- Node.js 20+
- A PostgreSQL instance
- An Anthropic API key
- A Coinbase Developer Platform (CDP) API key (`CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`) for the x402 facilitator's verify/settle endpoints

### Backend

```bash
git clone https://github.com/Shanks-btc/Metron.git
cd Metron
npm install
cp .env.example .env   # fill in DATABASE_URL, SELLER_ADDRESS, ANTHROPIC_API_KEY, CDP_API_KEY_ID, CDP_API_KEY_SECRET, etc.
npm start              # runs src/server.ts on :3000
```

### Frontend

```bash
cd web
npm install
cp .env.local.example .env.local   # optional - defaults already point at localhost:3000 and Base mainnet
npm run dev             # runs on :3001
```

### Buyer agent CLI (optional, exercises a real payment)

```bash
node --experimental-transform-types --no-warnings buyer-agent/index.ts --dry-run
# or, with a funded Base mainnet wallet holding real USDC:
BUYER_PRIVATE_KEY=0x... node --experimental-transform-types --no-warnings buyer-agent/index.ts
```

## API reference

```
POST /quote
  { tool, args, proposedPrice }  →  { decision, agreedPrice, negotiationId, quoteId, payUrl }

GET /pay/:id
  Header: PAYMENT-SIGNATURE (signed EIP-3009 payment authorization)
  →  { message, tool, agreedPrice, data, negotiationId, round, payerAddress }

POST /agent-quote
  { question, maxBudget }
  →  { tool, openingOffer, walkAwayCeiling, reasoningRecord, quoteId, agreed, reasoningHash }

GET /pricing
  → live cost-floor / ask-price table for every tool, seller address, and settlement network

GET /activity
  → recent negotiation sessions (metadata only, never the paid data itself)

GET /reasoning/:negotiationId
  → the stored reasoningRecord JSON for an AI-agent negotiation, for
    independent hash verification

GET /revenue
  → the seller wallet's real, current USDC balance on Base mainnet
```

## Project structure

```
Metron/
  src/
    server.ts                   ← Express API, /quote, /pay/:id, /agent-quote, /reasoning
    reasoning.ts / pricingLayer.ts  ← negotiation engine, tool-selection router, bounded-LLM pricing
    reasoningHash.ts             ← canonical serialization + keccak256
  buyer-agent/
    index.ts                     ← CLI demo: negotiate, then pay via x402
  web/
    src/
      app/                      ← Next.js pages (/, /dashboard, /docs)
      components/                ← NegotiationSection, ProofSection, etc.
      lib/
        payX402.ts                ← browser wallet x402 payment flow
  docs/
    architecture.md              ← full design + verified-fact log
```

## Known limitations

Documented plainly, not hidden:

- No self-service refunds — x402's `exact` scheme is a direct signed transfer, not an escrow contract; a payment that settles but then fails at data delivery is recorded (`fulfillmentFailure`) rather than silently dropped, but has no automated refund path.
- Human-typed negotiations produce no reasoning record — there is no AI reasoning to hash in that mode.
- The reasoning-hash audit record is off-chain only, by design (see above) — not yet backed by a real on-chain commitment.
- The homepage's "Proof" section shows representative example negotiations rather than a live feed, to avoid ever displaying an empty state on a fresh database; real settlement history is fully queryable via the API regardless.

## Roadmap

- Expand the live intelligence catalog beyond the current three providers.
- A CDP Paymaster-sponsored on-chain commitment for the reasoning-hash audit record, if a stronger anchor is needed.
- Continue iterating based on real usage.

## Team

Solo builder — full-stack Web3 developer, smart contracts, AI-agent infrastructure.

| Channel | Handle |
|---|---|
| X | [@Shank_btc](https://x.com/Shank_btc) |
| GitHub | [Shanks-btc](https://github.com/Shanks-btc) |

---

*Metron — machines that negotiate their own data prices, settled for real, via x402 on Base.*
