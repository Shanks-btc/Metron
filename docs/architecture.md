# Metron - Architecture

## What this is
Metron is Bidwell's negotiation engine, rewired to settle via the x402 protocol on Base
mainnet instead of a self-facilitated escrow contract on BOT Chain. The negotiation
mechanism (propose -> accept/counter/reject -> settle -> deliver) is unchanged. What
changes is everything behind `/pay/:id`: the settlement mechanism, the settlement asset,
and the chain itself.

## Why this is not a redeploy
Two prior settlement layers existed in this codebase and both are now fully removed:
Circle Gateway on Arc Testnet (the original Valiquo build), and a self-facilitated escrow
contract (`BidwellSettlement.sol`) on BOT Chain, since BOT Chain has no x402 facilitator of
its own. Base mainnet has a real, hosted x402 facilitator (Coinbase's, via `@coinbase/x402`),
so this rebuild is a return to the standard x402 shape rather than a second bespoke
settlement layer - `@x402/express`, `@x402/core`, and `@x402/evm` (the generic,
chain-agnostic v2 x402 packages) replace both `createGatewayMiddleware` and
`BidwellSettlement.sol` entirely.

## Request flow (unchanged in shape from Bidwell/Valiquo)
Buyer -> POST /quote {tool, args, proposedPrice} -> decide() runs (unchanged): accept/reject/
counter -> returns {decision, quoteId, agreedPrice, payUrl}
Buyer -> GET /pay/:id (unpaid) -> 402 (Metron's x402 resource server intercepts here)
Buyer -> GET /pay/:id (signed EIP-3009 payment authorization) -> Coinbase's hosted
facilitator verifies + settles on Base mainnet -> callMcpTool(tool, args) -> real data
returned
Buyer <- {message, tool, agreedPrice, data, negotiationId, round, payerAddress}

## Base mainnet network facts
- Chain ID: 8453. CAIP-2: `eip155:8453`. Explorer: https://basescan.org.
- Settlement asset: real Base mainnet USDC (Circle-issued), `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
  - decimals: 6. Not a bridged or wrapped stand-in, unlike BOT Chain's bridged "USDT" - no
    provenance caveat needed here.
- Facilitator: Coinbase's hosted x402 facilitator (`@coinbase/x402`), authenticated via
  `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` (Coinbase Developer Platform credentials) for the
  `verify`/`settle` endpoints. The `list` (bazaar discovery) endpoint works unauthenticated.

## The payment gate - real SDK shapes, not a from-scratch protocol implementation
`src/server.ts` wires `@x402/express`'s `paymentMiddleware` in front of `GET /pay/:id`,
backed by an `x402ResourceServer` (`@x402/core/server`) registered with `ExactEvmScheme`
(`@x402/evm/exact/server`) for `eip155:8453`, and an `HTTPFacilitatorClient` pointed at
Coinbase's `facilitator` config (`@coinbase/x402`).

Each quote has its own negotiated price - not a fixed per-route amount - so the route's
`price` is a `DynamicPrice` function (a real, documented v2 type) that looks up the
quote's `agreed_price` from Postgres per request, returning an explicit
`{ asset: BASE_USDC_ADDRESS, amount }` rather than relying on a `"$x.xx"` shorthand's
implicit per-network default asset.

The `OPEN -> PROCESSING -> FULFILLED` quote state machine (unchanged in shape from the
Circle Gateway build) is now driven by `x402ResourceServer`'s own lifecycle hooks
(`onBeforeVerify`, `onVerifyFailure`, `onSettleFailure`, `onAfterSettle`) instead of a
bespoke gateway SDK's hooks - `onBeforeVerify` flips `OPEN -> PROCESSING` only once a real
signed payment authorization arrives, `onVerifyFailure`/`onSettleFailure` recover a
transient failure back to `OPEN`, and `onAfterSettle` flips a real success to `FULFILLED`
using the facilitator's own `payer`/`transaction` fields - never derived or guessed.
Since these hooks don't receive Express's resolved route params, the quote id is
extracted from the hook's `transportContext.request.path` with a plain regex - the same
extraction `DynamicPrice` itself uses.

## The reasoning-hash mechanism - off-chain audit record, not an on-chain commitment
Unlike `BidwellSettlement.openDeal()`, which had a dedicated `reasoningHash` argument to
commit to on-chain, x402's `exact` scheme settles via a plain signed USDC transfer with no
calldata slot for an app-level commitment. Rather than add a second, separate on-chain
transaction just to anchor a hash, this mechanism stays exactly what it already was minus
the on-chain leg: the backend serializes the pricing layer's actual decision (policy
bounds applied, opening offer chosen, reasoning text, timestamp) as canonical JSON,
computes `keccak256` of that JSON, and stores the full JSON in Postgres keyed by
`negotiationId`. Anyone can independently pull the stored JSON (via
`GET /reasoning/:negotiationId`) and recompute the hash to confirm it matches what this
API returned at the moment the deal was agreed - a standard hash-commitment pattern, just
without a third, on-chain copy to cross-check against.

A CDP Paymaster-sponsored on-chain commitment transaction (reusing the same
fire-and-forget-after-real-payment pattern the old Arc-based `settlementLog.ts` proved)
remains a reasonable future addition if a stronger anchor is ever needed - not part of
this build.

## Core logic - decide(tool, proposedPrice), unchanged
Not modified in this rebuild. Four-branch logic (accept-at-ask / accept-at-offer /
counter-at-floor / reject), same as every prior version of this product.

## Bounded-LLM pricing layer (unchanged)
Sits between the buyer-agent's natural-language request and the existing `/quote` call.
Given a question and a policy (max budget, minimum data freshness, acceptable price
range), an LLM call sets the *opening proposed price* and the *walk-away ceiling* - a real
economic decision, bounded by hard-coded limits the LLM cannot override. `decide()` on the
server side is completely unchanged and still enforces the actual floor/ask logic
deterministically.

## File map (changes from Bidwell's map)
- Removed entirely: `contracts/` (both `.sol` files), `test/BidwellSettlement.test.js`,
  `hardhat.config.js`, `src/settlementBot.ts`, `src/fulfillmentListener.ts`,
  `src/BidwellSettlementAbi.ts`, `src/settlementLog.ts`, the Circle Gateway wiring
  previously in `src/server.ts`.
- `src/server.ts` - the x402/Base payment gate described above replaces both the old
  Circle Gateway middleware and the read-only BOT Chain event-query endpoint.
- `web/src/lib/payX402.ts` - replaces `web/src/lib/walletPay.ts`; browser-wallet EIP-3009
  signing via `@x402/fetch` instead of direct `approve()`/`openDeal()` contract calls.
- `buyer-agent/index.ts` - pays via the same x402 client flow (Node-side, a raw private
  key satisfies the SDK's minimal signer interface directly) instead of `GatewayClient`.

## What is proven vs not yet built
Proven: the negotiation engine end-to-end (all four `decide()` branches), the bounded-LLM
pricing layer's budget clamp (`clampToPolicy()`, deterministic unit test), the server
booting locally against live Postgres/Anthropic/MCP-seller infrastructure with the new
x402 wiring in place.

Not yet proven in this environment: a real signed payment settling through Coinbase's
hosted facilitator end-to-end against Base mainnet (requires a funded wallet holding real
USDC and a live deploy - not exercised as part of this rewiring pass). Do not present this
as demonstrated until a real payment has actually been run and independently re-verified,
per this project's own standing discipline of not pre-filling "proven" claims ahead of
real evidence.
