/**
 * Metron - a negotiated-price payment layer in front of live financial
 * and on-chain intelligence data, settled via x402 on Base mainnet through
 * Coinbase's hosted facilitator (@coinbase/x402).
 *
 * Three sellers: BTC Cycle Intelligence (5 tools), Short Squeeze
 * Intelligence (2 priced tools), and Analyst Momentum (3 priced tools) -
 * see the TOOLS map comments for why each seller's real MCP tool count is
 * larger than the number of separately priced entries.
 */

import express from "express";
import cors from "cors";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { facilitator } from "@coinbase/x402";
import { createPublicClient, http, erc20Abi } from "viem";
import { base } from "viem/chains";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { selectTool } from "./reasoning.ts";
import { proposeAndNegotiate, callQuote } from "./pricingLayer.ts";
import { hashReasoningRecord } from "./reasoningHash.ts";

const app = express();
app.use(express.json());
// Allows the web/ frontend (localhost:3001, later its production domain) to
// call this API directly from the browser. CORS_ORIGIN is unset by default
// (wide open, current dev behavior - the `cors` package defaults to
// reflecting "*" when no `origin` key is passed at all) - set it to the
// real deployed frontend's origin once that domain exists to restrict
// cross-origin access to just that site. exposedHeaders is required so
// browser JS can actually read these two custom response headers via
// fetch's Response.headers - without it the request succeeds but the
// headers are invisible to client code, even same-origin-looking code, per
// the CORS spec's default header allowlist. Header names are unchanged from
// the v1/Circle-era x402 protocol shape - the v2 spec (@x402/core) still
// uses PAYMENT-REQUIRED/PAYMENT-RESPONSE.
const corsOptions: cors.CorsOptions = { exposedHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE"] };
if (process.env.CORS_ORIGIN) {
  corsOptions.origin = process.env.CORS_ORIGIN;
}
app.use(cors(corsOptions));

const SELLER_ADDRESS = process.env.SELLER_ADDRESS as `0x${string}` | undefined;

const BTC_CYCLE_MCP_URL =
  process.env.BTC_CYCLE_MCP_URL ?? "https://btc-cycle-intelligence-production-410b.up.railway.app/mcp";

const SHORT_SQUEEZE_MCP_URL =
  process.env.SHORT_SQUEEZE_MCP_URL ?? "https://short-squeeze-intelligence-production-6b31.up.railway.app/mcp";

const ANALYST_MOMENTUM_MCP_URL =
  process.env.ANALYST_MOMENTUM_MCP_URL ?? "https://analyst-momentum-production-4a1d.up.railway.app/mcp";

interface ToolConfig {
  mcpUrl: string;
  costFloor: number;
  askPrice: number;
  // Present only for tools that need caller-supplied arguments (e.g. a
  // ticker). Checked in decide() before any price negotiation - a quote
  // for a tool missing a required arg would otherwise still get priced and
  // paid, only failing later at fulfillment.
  requiredArgs?: string[];
}

// Single lookup spanning both sellers - tool name is the key everywhere
// this map is used (decide(), callMcpTool(), /pricing), so one merged map
// avoids a second seller-indirection layer. Tool names are already unique
// across both sellers' real tool sets.
const TOOLS: Record<string, ToolConfig> = {
  get_btc_cycle_regime: { mcpUrl: BTC_CYCLE_MCP_URL, costFloor: 0.003, askPrice: 0.008 },
  get_lth_behavior: { mcpUrl: BTC_CYCLE_MCP_URL, costFloor: 0.0015, askPrice: 0.004 },
  get_entry_risk: { mcpUrl: BTC_CYCLE_MCP_URL, costFloor: 0.0015, askPrice: 0.004 },
  compare_to_2021_top: { mcpUrl: BTC_CYCLE_MCP_URL, costFloor: 0.002, askPrice: 0.005 },
  get_nupl_sentiment: { mcpUrl: BTC_CYCLE_MCP_URL, costFloor: 0.0015, askPrice: 0.004 },
  // Short Squeeze Intelligence exposes 5 MCP tool names, but only 2 are
  // priced here. Confirmed live against the seller's own source
  // (short-squeeze-intelligence/src/index.js): tools/call routes every
  // tool name except compare_squeeze_risk through the identical
  // getSqueezeData(ticker) call, with no differentiation by tool name -
  // get_short_interest, get_cost_to_borrow, and get_short_interest_trend
  // return byte-identical payloads to get_squeeze_risk for the same
  // ticker. Pricing them as separate paid products would charge for the
  // same output under different names, so they deliberately have no
  // TOOLS entry - get_squeeze_risk is the one priced, real single-ticker
  // offering.
  get_squeeze_risk: { mcpUrl: SHORT_SQUEEZE_MCP_URL, costFloor: 0.003, askPrice: 0.008, requiredArgs: ["ticker"] },
  compare_squeeze_risk: {
    mcpUrl: SHORT_SQUEEZE_MCP_URL,
    costFloor: 0.002,
    askPrice: 0.005,
    requiredArgs: ["ticker1", "ticker2"],
  },
  // Analyst Momentum exposes 8 MCP tool names, but only 3 are priced here.
  // Confirmed live against the seller's own source (Analyst momentum/src/
  // index.js): tools/call routes get_analyst_consensus, get_analyst_price_
  // target, get_sentiment_shift, get_analyst_conviction, and get_bearish_
  // reversal_signal all through the identical getAnalystMomentum(ticker)
  // call and return the same structuredContent for the same ticker - only
  // the human-readable text summary differs per name. Same reasoning as
  // Short Squeeze's unpriced duplicates: pricing them separately would
  // charge for the same output under different names. get_analyst_momentum
  // (the full composite), compare_analyst_momentum, and
  // screen_analyst_momentum each do genuinely distinct computation, so
  // those are the 3 priced here. askPrice for get_analyst_momentum is the
  // seller's own declared _meta.pricing.queryUsd ($0.07) - used directly,
  // not invented; the other two are scaled off it using this map's
  // existing flagship/compare price ratios.
  get_analyst_momentum: {
    mcpUrl: ANALYST_MOMENTUM_MCP_URL,
    costFloor: 0.025,
    askPrice: 0.07,
    requiredArgs: ["ticker"],
  },
  compare_analyst_momentum: {
    mcpUrl: ANALYST_MOMENTUM_MCP_URL,
    costFloor: 0.018,
    askPrice: 0.045,
    requiredArgs: ["ticker1", "ticker2"],
  },
  screen_analyst_momentum: {
    mcpUrl: ANALYST_MOMENTUM_MCP_URL,
    costFloor: 0.03,
    askPrice: 0.08,
    requiredArgs: ["tickers"],
  },
};

if (!SELLER_ADDRESS) {
  console.error("Missing SELLER_ADDRESS in .env");
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL in .env");
  process.exit(1);
}

// Named so /pricing can expose the real value instead of a second, drifting
// copy of the literal. CAIP-2 id for Base mainnet, overridable to Base
// Sepolia (eip155:84532) for live pre-mainnet payment testing - see
// scripts/test-x402-sepolia.mjs. Defaults to mainnet so no env change means
// no behavior change.
const NETWORK = (process.env.X402_NETWORK ?? "eip155:8453") as `${string}:${string}`;

// Real, canonical USDC for whichever network above is active (Base mainnet
// by default; Base Sepolia test USDC when X402_NETWORK/X402_USDC_ADDRESS are
// overridden) - not a bridged/wrapped token. Used as the explicit settlement
// asset for every quote rather than relying on the "$0.006"-style
// shorthand's implicit per-network default, so the exact contract this
// product settles in is never ambiguous.
const BASE_USDC_ADDRESS = (process.env.X402_USDC_ADDRESS ?? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") as `0x${string}`;

// EIP-712 domain for the settlement asset above - required in `extra` on the
// route's `accepts` entry because that route uses an explicit
// { asset, amount } AssetAmount (see the DynamicPrice resolver below) rather
// than the SDK's "$x.xx" shorthand. The shorthand auto-resolves a known
// per-network default asset via @x402/evm's DEFAULT_ASSETS table, which
// already carries the right EIP-712 name/version - bypassing it by naming
// the asset explicitly means this domain has to be supplied by hand instead,
// or ExactEvmScheme's client side has nothing to sign against and every
// payment attempt fails before a request is even sent (confirmed by a real
// failed payment attempt: "EIP-712 domain parameters (name, version) are
// required..."). Both values below were read directly from each contract's
// own name()/version() and independently re-verified by recomputing
// keccak256(EIP712Domain(...)) and confirming it matches that contract's own
// on-chain DOMAIN_SEPARATOR() byte-for-byte - not copied from documentation.
// Real Base mainnet USDC (0x8335...) and Base Sepolia's test USDC
// (0x036C...) do NOT share the same name ("USD Coin" vs "USDC"), which is
// exactly why this has its own override pair rather than being hardcoded.
const BASE_USDC_EIP712_NAME = process.env.X402_USDC_EIP712_NAME ?? "USD Coin";
const BASE_USDC_EIP712_VERSION = process.env.X402_USDC_EIP712_VERSION ?? "2";

// Coinbase's hosted facilitator (@coinbase/x402) - `facilitator` reads
// CDP_API_KEY_ID/CDP_API_KEY_SECRET from the environment for the verify/settle
// endpoints it needs (see that package's own docs); the discovery-only `list`
// endpoint works unauthenticated. HTTPFacilitatorClient is @x402/core's
// generic HTTP transport for talking to any x402 facilitator - Coinbase's is
// just the one configured here.
const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient(facilitator)).register(
  NETWORK,
  new ExactEvmScheme()
);

type QuoteState = "OPEN" | "PROCESSING" | "FULFILLED";

interface Quote {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  agreedPrice: number;
  createdAt: number;
  state: QuoteState;
  negotiationId: string;
  round: number;
  // Recorded at creation so /activity can tell an open accept apart from an
  // unresolved counter - both look identical via `state` alone until paid.
  decision: "accept" | "counter";
  // Set when payment settled (state is FULFILLED) but callMcpTool() kept
  // failing after retries - a "paid, undelivered" record, kept visible
  // rather than silently dropped.
  fulfillmentFailure?: string;
  // The real payer address from the facilitator's settle response (see
  // resourceServer.onAfterSettle below) - only ever set once payment has
  // actually landed.
  payerAddress?: string;
}

// --- Postgres-backed storage -------------------------------------------
// Was three in-memory stores (quotes Map, negotiationRounds Map, rejections
// array) that reset to empty on every process restart - real user
// transaction history was lost whenever the server redeployed or crashed.
// Railway's Postgres addon (DATABASE_URL) now backs all three so /activity
// and quote state survive a restart.
const { Pool, types } = pg;

// BIGINT (oid 20) columns come back as strings from node-postgres by
// default, since JS numbers can't safely represent the full int8 range.
// createdAt is always a Date.now() value, always well within
// Number.MAX_SAFE_INTEGER, so it's safe to parse back to a plain number
// globally rather than converting at every call site.
types.setTypeParser(20, (val: string) => parseInt(val, 10));

const pool = new Pool({
  connectionString: DATABASE_URL,
  // Railway's managed Postgres requires TLS for external connections (e.g.
  // the public proxy URL used for local dev/testing) but presents a cert
  // that isn't chained to a public CA - the standard PaaS pattern is to
  // encrypt without verifying against a public root. Local Postgres
  // (localhost) and Railway's own *.railway.internal private network (used
  // when this server itself runs on Railway, talking to the Postgres
  // service over its private network) need no TLS at all.
  ssl: /localhost|127\.0\.0\.1|\.railway\.internal/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
});

// An idle client emitting an error (e.g. the connection was dropped by the
// server) is an 'error' event on the Pool itself in node-postgres - without
// a listener, that's an unhandled 'error' event, which crashes the process.
// This is a defensive addition the in-memory Maps never needed a DB can
// misbehave in ways a JS object never could.
pool.on("error", (err) => {
  console.error("Unexpected Postgres pool error:", err);
});

async function ensureSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS quotes (
      id TEXT PRIMARY KEY,
      negotiation_id TEXT NOT NULL,
      round INTEGER NOT NULL,
      tool TEXT NOT NULL,
      args JSONB NOT NULL DEFAULT '{}'::jsonb,
      agreed_price DOUBLE PRECISION NOT NULL,
      created_at BIGINT NOT NULL,
      state TEXT NOT NULL,
      decision TEXT NOT NULL,
      payer_address TEXT,
      fulfillment_failure TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rejections (
      id SERIAL PRIMARY KEY,
      tool TEXT NOT NULL,
      negotiation_id TEXT NOT NULL,
      round INTEGER NOT NULL,
      created_at BIGINT NOT NULL
    )
  `);
  // Not part of the Quote interface, but negotiationRounds was the second of
  // the three in-memory stores this migration covers - the round counter
  // needs to survive a restart exactly like quotes/rejections do, or a
  // negotiation resuming after a redeploy would start re-using round
  // numbers already spent before the restart.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS negotiation_rounds (
      negotiation_id TEXT PRIMARY KEY,
      round INTEGER NOT NULL
    )
  `);
  // Stores the full canonical reasoningRecord (see pricingLayer.ts /
  // reasoningHash.ts) for the AI-agent negotiation path, so anyone can
  // independently re-fetch it via GET /reasoning/:negotiationId and
  // recompute the hash themselves - an off-chain, API-checkable audit
  // record (there is no on-chain escrow transaction to attach it to under
  // the x402/Base flow - see docs/architecture.md).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reasoning_records (
      negotiation_id TEXT PRIMARY KEY,
      reasoning_hash TEXT NOT NULL,
      record JSONB NOT NULL,
      created_at BIGINT NOT NULL
    )
  `);
}

function rowToQuote(row: any): Quote {
  return {
    id: row.id,
    tool: row.tool,
    args: row.args ?? {},
    agreedPrice: Number(row.agreed_price),
    createdAt: row.created_at,
    state: row.state,
    negotiationId: row.negotiation_id,
    round: row.round,
    decision: row.decision,
    fulfillmentFailure: row.fulfillment_failure ?? undefined,
    payerAddress: row.payer_address ?? undefined,
  };
}

// How long an accepted/countered quote stays payable. Needs to comfortably
// cover a real human wallet-signing flow (connect wallet, review, sign) -
// 120s proved too short in practice, so this is 10 minutes rather than
// something that makes the negotiation feel meaningfully less "live".
const QUOTE_TTL_MS = 600_000;

// Per-negotiationId round counter, enforced server-side (not just by the
// buyer's own attempt loop). Default cap chosen to bound a single
// negotiation session to a handful of back-and-forth offers.
const MAX_NEGOTIATION_ROUNDS = 5;

// Lightweight record of rejected proposals for /activity. A reject never
// creates a Quote, so without this a rejection would leave zero trace.
// Deliberately excludes proposedPrice/reason - activity metadata should
// never leak how close a lowball offer was to the real cost floor.
interface Rejection {
  tool: string;
  negotiationId: string;
  round: number;
  createdAt: number;
}

// Atomic upsert-and-increment: a single statement, so two concurrent /quote
// calls for the same (rare, but possible) negotiationId can't both read the
// same starting count before either writes, the way a separate read-then-
// write pair could. Postgres serializes concurrent INSERT ... ON CONFLICT
// DO UPDATE on the same row via its normal row-level locking, so this keeps
// the same atomicity the in-memory Map's synchronous get+set had.
async function nextNegotiationRound(negotiationId: string): Promise<number> {
  const result = await pool.query(
    `INSERT INTO negotiation_rounds (negotiation_id, round) VALUES ($1, 1)
     ON CONFLICT (negotiation_id) DO UPDATE SET round = negotiation_rounds.round + 1
     RETURNING round`,
    [negotiationId]
  );
  return result.rows[0].round;
}

// Express 4 does not catch rejected promises from async route handlers -
// an unhandled rejection there just hangs the request. This wraps a handler
// so a thrown/rejected DB error reaches Express's error middleware instead.
// The in-memory Maps never needed this since a Map access can't throw.
function asyncHandler(
  fn: (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<void>
) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

function decide(
  tool: string,
  proposedPrice: number,
  args: Record<string, unknown>
): { decision: "accept" | "reject" | "counter"; price: number; reason: string } {
  const config = TOOLS[tool];
  if (!config) {
    return { decision: "reject", price: 0, reason: `Unknown tool: ${tool}` };
  }
  if (config.requiredArgs) {
    // Most required args are single ticker strings, but screen_analyst_momentum's
    // "tickers" is an array (2-5 symbols) - a required arg is missing if it's an
    // empty/blank string, or an empty array.
    const missing = config.requiredArgs.filter((key) => {
      const value = args[key];
      if (Array.isArray(value)) return value.length === 0;
      return typeof value !== "string" || !value;
    });
    if (missing.length > 0) {
      return { decision: "reject", price: 0, reason: `Missing required argument(s): ${missing.join(", ")}` };
    }
  }
  const floor = config.costFloor;
  const ask = config.askPrice;

  if (proposedPrice >= ask) {
    return { decision: "accept", price: ask, reason: "Offer meets or exceeds asking price." };
  }
  if (proposedPrice >= floor) {
    return { decision: "accept", price: proposedPrice, reason: "Offer clears cost floor; accepted at proposed price." };
  }
  if (proposedPrice >= floor * 0.5) {
    return { decision: "counter", price: floor, reason: "Offer below cost floor; countering at floor price." };
  }
  return { decision: "reject", price: 0, reason: "Offer too far below cost floor to be worth countering." };
}

app.post("/quote", asyncHandler(async (req, res) => {
  const { tool, args, proposedPrice, negotiationId: incomingNegotiationId } = req.body as {
    tool: string;
    args?: Record<string, unknown>;
    proposedPrice: number;
    negotiationId?: string;
  };

  if (!tool || typeof proposedPrice !== "number") {
    res.status(400).json({ error: "tool and proposedPrice are required" });
    return;
  }

  const negotiationId = incomingNegotiationId ?? crypto.randomUUID();
  const round = await nextNegotiationRound(negotiationId);

  if (round > MAX_NEGOTIATION_ROUNDS) {
    await pool.query(
      `INSERT INTO rejections (tool, negotiation_id, round, created_at) VALUES ($1, $2, $3, $4)`,
      [tool, negotiationId, round, Date.now()]
    );
    res.status(200).json({
      decision: "reject",
      reason: `Max negotiation rounds (${MAX_NEGOTIATION_ROUNDS}) exceeded for this session.`,
      negotiationId,
      round,
    });
    return;
  }

  const result = decide(tool, proposedPrice, args ?? {});

  if (result.decision === "reject") {
    await pool.query(
      `INSERT INTO rejections (tool, negotiation_id, round, created_at) VALUES ($1, $2, $3, $4)`,
      [tool, negotiationId, round, Date.now()]
    );
    res.status(200).json({ decision: "reject", reason: result.reason, negotiationId, round });
    return;
  }

  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO quotes (id, negotiation_id, round, tool, args, agreed_price, created_at, state, decision)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'OPEN', $8)`,
    [id, negotiationId, round, tool, JSON.stringify(args ?? {}), result.price, Date.now(), result.decision]
  );

  res.status(200).json({
    decision: result.decision,
    quoteId: id,
    agreedPrice: result.price,
    reason: result.reason,
    payUrl: `/pay/${id}`,
    expiresInSeconds: QUOTE_TTL_MS / 1000,
    negotiationId,
    round,
  });
}));

// GET /activity - metadata about past negotiations (never the paid BTC
// Cycle Intelligence content itself, and never a rejected proposal's
// price/reason - see the Rejection comment above). Reads from Postgres, so
// unlike the old in-memory Maps/array, this now survives a server restart.
//
// Decision derivation:
// - FULFILLED or PROCESSING: someone has already committed to paying this
//   quote's agreedPrice, so it counts as "accepted" regardless of whether
//   that price arrived via an immediate accept or a countered price that
//   was paid later.
// - OPEN: falls back to the decision recorded on the Quote at creation
//   time, since an open accept and an unresolved counter are otherwise
//   indistinguishable from stored state alone.
// - Entries with no Quote at all (rejections) are always "rejected".
const DEFAULT_ACTIVITY_LIMIT = 100;

app.get("/activity", asyncHandler(async (req, res) => {
  const limitParam = Number(req.query.limit);
  const limit =
    Number.isFinite(limitParam) && limitParam > 0 ? Math.floor(limitParam) : DEFAULT_ACTIVITY_LIMIT;

  // Optional ?tool=a,b,c filter, applied before the sort+slice below (not
  // as a LIMIT-N-then-filter, which would reintroduce the exact bug this
  // exists to fix). Without this, a caller can only ever ask for "the most
  // recent N events across every tool combined" - fine for the Dashboard's
  // all-tools stats, but wrong for a per-provider "most recent settled deal
  // for tool X" query: a low-volume tool's real history silently falls out
  // of a shared window as soon as enough unrelated higher-volume tools
  // accumulate more recent activity than the window size. Filtering first
  // means a caller asking specifically about tool X always sees X's own
  // most recent events, regardless of how much other tools' traffic exists.
  const toolParam = typeof req.query.tool === "string" ? req.query.tool : undefined;
  const toolFilter = toolParam
    ? new Set(toolParam.split(",").map((t) => t.trim()).filter(Boolean))
    : null;

  const [quotesResult, rejectionsResult] = await Promise.all([
    pool.query(`SELECT * FROM quotes`),
    pool.query(`SELECT * FROM rejections`),
  ]);

  const fromQuotes = quotesResult.rows
    .map(rowToQuote)
    .filter((quote) => !toolFilter || toolFilter.has(quote.tool))
    .map((quote) => ({
      quoteId: quote.id,
      negotiationId: quote.negotiationId,
      round: quote.round,
      tool: quote.tool,
      decision:
        quote.state === "FULFILLED" || quote.state === "PROCESSING" || quote.decision === "accept"
          ? ("accepted" as const)
          : ("countered" as const),
      agreedPrice: quote.agreedPrice,
      createdAt: quote.createdAt,
      state: quote.state as string,
      // Only ever surfaced once a real payment has actually settled - never
      // for OPEN/PROCESSING records, where no payer exists yet.
      payerAddress: quote.state === "FULFILLED" ? quote.payerAddress ?? null : null,
    }));

  const fromRejections = rejectionsResult.rows
    .filter((r) => !toolFilter || toolFilter.has(r.tool as string))
    .map((r) => ({
      quoteId: null as string | null,
      negotiationId: r.negotiation_id as string,
      round: r.round as number,
      tool: r.tool as string,
      decision: "rejected" as const,
      agreedPrice: null as number | null,
      createdAt: r.created_at as number,
      state: null as string | null,
      payerAddress: null as string | null,
    }));

  const activity = [...fromQuotes, ...fromRejections]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map((entry) => ({ ...entry, createdAt: new Date(entry.createdAt).toISOString() }));

  res.status(200).json(activity);
}));

// GET /pricing - read-only pricing configuration: the real cost floor and
// ask price /quote negotiates against for each tool, plus the seller
// address and settlement network, straight from this file's own constants
// (never a second, hand-copied set of numbers). Purely additive - no
// negotiation logic here.
app.get("/pricing", (_req: express.Request, res: express.Response) => {
  const tools = Object.entries(TOOLS).map(([tool, config]) => ({
    tool,
    costFloor: config.costFloor,
    askPrice: config.askPrice,
    requiredArgs: config.requiredArgs ?? [],
  }));
  res.status(200).json({ sellerAddress: SELLER_ADDRESS, network: NETWORK, tools });
});

// POST /ask - LLM reasoning layer sitting in front of the negotiation flow.
// Given a natural-language question, an LLM call (see reasoning.ts) decides
// which one of the priced tools across both sellers (if any) answers it,
// and returns its reasoning so the choice is inspectable rather than a
// black box. Purely a router: it never calls decide(), never touches
// Postgres or the state machine, and never itself negotiates or pays - the
// caller takes the returned tool name to the existing, unchanged POST
// /quote.
app.post("/ask", asyncHandler(async (req, res) => {
  const { question } = req.body as { question?: string };
  if (!question || typeof question !== "string") {
    res.status(400).json({ error: "question is required" });
    return;
  }

  let selection;
  try {
    selection = await selectTool(
      question,
      Object.entries(TOOLS).map(([name, config]) => ({ name, mcpUrl: config.mcpUrl }))
    );
  } catch (err) {
    res.status(502).json({ error: "Tool-selection reasoning failed", detail: (err as Error).message });
    return;
  }

  if (selection.tool === "none") {
    res.status(200).json({
      answered: false,
      reasoning: selection.reasoning,
      confidence: selection.confidence,
    });
    return;
  }

  const config = TOOLS[selection.tool];
  res.status(200).json({
    answered: true,
    tool: selection.tool,
    reasoning: selection.reasoning,
    confidence: selection.confidence,
    costFloor: config.costFloor,
    askPrice: config.askPrice,
    requiredArgs: config.requiredArgs ?? [],
    nextStep: "POST /quote with { tool, args: {}, proposedPrice } to negotiate a price for this tool.",
  });
}));

// POST /agent-quote - the AI-agent negotiation path: given a question and a
// maxBudget, pricingLayer.ts's bounded-LLM layer picks a tool (via
// reasoning.ts, unchanged), proposes an opening offer and a walk-away
// ceiling, and negotiates for real against the existing, unchanged /quote +
// decide(). Unlike POST /ask (routing only, no price) and unlike the
// human-typed demo flow (which has no real reasoning behind a manually
// typed number), a deal reached here has a genuine reasoningRecord, so its
// canonical hash is computed and stored in reasoning_records right here, at
// the moment of agreement - independently fetchable and re-checkable via
// GET /reasoning/:negotiationId (see that endpoint's own comment for why
// this is an off-chain, not on-chain, audit record under the x402/Base flow).
//
// pricingLayer.ts's proposeAndNegotiate() only ever sends one /quote call
// and returns whatever decide() said - if countered, this re-proposes once
// at the countered price via callQuote() (already exported from
// pricingLayer.ts), the same counter-round pattern used in
// scripts/test-pricing-layer.mjs, capped by the pricing layer's own
// walkAwayCeiling rather than looping indefinitely.
app.post("/agent-quote", asyncHandler(async (req, res) => {
  const { question, maxBudget } = req.body as { question?: string; maxBudget?: number };
  if (!question || typeof question !== "string" || typeof maxBudget !== "number") {
    res.status(400).json({ error: "question (string) and maxBudget (number) are required" });
    return;
  }

  let result;
  try {
    result = await proposeAndNegotiate(question, { maxBudget });
  } catch (err) {
    res.status(502).json({ error: "Pricing layer failed", detail: (err as Error).message });
    return;
  }

  if (!result.ok) {
    res.status(200).json({ answered: false, reason: result.reason });
    return;
  }

  let quote = result.quote;
  if (quote.decision === "counter" && typeof quote.agreedPrice === "number" && quote.agreedPrice <= result.walkAwayCeiling) {
    quote = await callQuote(result.tool, {}, quote.agreedPrice, quote.negotiationId);
  }

  const base_ = {
    answered: true,
    tool: result.tool,
    openingOffer: result.openingOffer,
    walkAwayCeiling: result.walkAwayCeiling,
    reasoningRecord: result.reasoningRecord,
    decision: quote.decision,
    reason: quote.reason,
    negotiationId: quote.negotiationId,
    round: quote.round,
    // The x402 payment gate (GET /pay/:id) is keyed by quoteId, not
    // negotiationId - the old BOT Chain flow only ever needed negotiationId
    // (BidwellSettlement.openDeal()'s escrow key), so this was never
    // surfaced here before. Undefined (dropped by JSON.stringify) on a
    // reject/unresolved-counter response, where no quote row exists yet.
    quoteId: quote.quoteId,
  };

  if (quote.decision !== "accept" || typeof quote.agreedPrice !== "number") {
    res.status(200).json({ ...base_, agreed: false });
    return;
  }

  const { canonicalJson, hash: reasoningHash } = hashReasoningRecord(result.reasoningRecord);
  await pool.query(
    `INSERT INTO reasoning_records (negotiation_id, reasoning_hash, record, created_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (negotiation_id) DO UPDATE SET reasoning_hash = $2, record = $3, created_at = $4`,
    [quote.negotiationId, reasoningHash, canonicalJson, Date.now()]
  );

  res.status(200).json({ ...base_, agreed: true, agreedPrice: quote.agreedPrice, reasoningHash });
}));

// GET /reasoning/:negotiationId - returns the stored canonical
// reasoningRecord JSON + its committed hash for a given negotiation, so the
// reasoning-hash commitment (see reasoning_records in ensureSchema()) is
// independently checkable by anyone, not just by the integration test that
// wrote it. Under the x402/Base flow there is no on-chain escrow
// transaction to attach this hash to (x402's "exact" scheme settles via a
// plain signed USDC transfer, with no calldata slot for an app-level
// commitment) - this is deliberately an off-chain-only audit record:
// anyone can still fetch it here, recompute keccak256 themselves, and
// confirm it matches the hash this API returned at agreement time. Purely
// additive, read-only - never touches quotes/decide()/the state machine.
app.get("/reasoning/:negotiationId", asyncHandler(async (req, res) => {
  const result = await pool.query(`SELECT * FROM reasoning_records WHERE negotiation_id = $1`, [req.params.negotiationId]);
  if (result.rows.length === 0) {
    res.status(404).json({ error: "No reasoning record for this negotiationId" });
    return;
  }
  const row = result.rows[0];
  res.status(200).json({
    negotiationId: row.negotiation_id,
    reasoningHash: row.reasoning_hash,
    record: row.record,
    createdAt: new Date(row.created_at).toISOString(),
  });
}));

// GET /revenue - read-only view of the seller's real Base USDC balance, via
// a plain public RPC read (no facilitator, no CDP credentials needed -
// balanceOf is a public on-chain read available to anyone). Additive and
// read-only: no negotiation/payment/state-machine logic here.
const basePublicClient = createPublicClient({ chain: base, transport: http() });

app.get("/revenue", asyncHandler(async (_req, res) => {
  const balance = await basePublicClient.readContract({
    address: BASE_USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [SELLER_ADDRESS as `0x${string}`],
  });

  res.status(200).json({
    sellerAddress: SELLER_ADDRESS,
    usdcBalance: (Number(balance) / 1_000_000).toFixed(6),
  });
}));

// --- x402 payment gate (Base mainnet, Coinbase-hosted facilitator) -----
// GET /pay/:id carries the whole payment lifecycle in three stages,
// registered in this order:
//   1. A plain guard route: validates the quote exists, is still OPEN, and
//      hasn't expired - returning the same 404/409/410 shapes this API has
//      always returned - before any payment machinery runs at all.
//   2. paymentMiddleware, registered globally via app.use() so it can gate
//      any route matching "GET /pay/:id" regardless of Express's own
//      path-param resolution; it 402s an unpaid request and only calls
//      next() once a real payment has verified and settled.
//   3. The final handler below, which runs only after payment has landed -
//      delivers the paid tool data exactly as before.
//
// Extracting quoteId: HTTPRequestContext (what both the DynamicPrice
// resolver and the resourceServer hooks below receive) only ever exposes
// the raw request path, not Express's resolved :id param - so quoteId is
// pulled from the path with a plain regex in both places.
const PAY_PATH_RE = /^\/pay\/([^/?]+)/;

function quoteIdFromPath(path: string | undefined): string | null {
  if (!path) return null;
  const match = PAY_PATH_RE.exec(path);
  return match ? match[1] : null;
}

function quoteIdFromContext(context: { transportContext?: unknown }): string | null {
  const path = (context.transportContext as { request?: { path?: string } } | undefined)?.request?.path;
  return quoteIdFromPath(path);
}

app.get("/pay/:id", asyncHandler(async (req, res, next) => {
  const result = await pool.query(`SELECT * FROM quotes WHERE id = $1`, [req.params.id]);
  if (result.rows.length === 0) { res.status(404).json({ error: "Unknown or expired quote" }); return; }
  const quote = rowToQuote(result.rows[0]);
  if (quote.state !== "OPEN") {
    const detail = quote.state === "FULFILLED" ? "Quote already redeemed" : "Payment already in progress for this quote";
    res.status(409).json({ error: detail });
    return;
  }
  if (Date.now() - quote.createdAt > QUOTE_TTL_MS) { res.status(410).json({ error: "Quote expired - request a new /quote" }); return; }
  next();
}));

app.use(paymentMiddleware(
  {
    "GET /pay/:id": {
      accepts: {
        scheme: "exact",
        network: NETWORK,
        payTo: SELLER_ADDRESS,
        // Each quote has its own negotiated agreedPrice - not a static
        // per-route price - so this is a DynamicPrice resolver rather than
        // a fixed "$x.xx" string. Returns an explicit AssetAmount (real
        // Base USDC address + raw 6-decimal amount) rather than relying on
        // the "$"-shorthand's implicit per-network default asset.
        price: async (context: { path: string }) => {
          const quoteId = quoteIdFromPath(context.path);
          const result = quoteId
            ? await pool.query(`SELECT agreed_price FROM quotes WHERE id = $1`, [quoteId])
            : { rows: [] as any[] };
          const agreedPrice = result.rows[0] ? Number(result.rows[0].agreed_price) : 0;
          return { asset: BASE_USDC_ADDRESS, amount: String(Math.round(agreedPrice * 1_000_000)) };
        },
        // Required because `price` returns an explicit AssetAmount instead
        // of a "$x.xx" string - see BASE_USDC_EIP712_NAME's comment above.
        // Without this, the client has no EIP-712 domain to sign the EIP-3009
        // authorization against and every payment fails before a request is
        // even sent.
        extra: { name: BASE_USDC_EIP712_NAME, version: BASE_USDC_EIP712_VERSION },
      },
      description: "Paid intelligence tool data",
      mimeType: "application/json",
    },
  },
  resourceServer
));

const MAX_FULFILLMENT_ATTEMPTS = 3;

app.get("/pay/:id", asyncHandler(async (req, res) => {
  // Payment has already verified, settled, and been marked FULFILLED (see
  // resourceServer.onAfterSettle below) by the time this handler runs - a
  // fulfillment failure from here on is a delivery problem, not a payment
  // problem.
  const result = await pool.query(`SELECT * FROM quotes WHERE id = $1`, [req.params.id]);
  const quote = rowToQuote(result.rows[0]);

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_FULFILLMENT_ATTEMPTS; attempt++) {
    try {
      const data = await callMcpTool(quote.tool, quote.args);
      await pool.query(`UPDATE quotes SET fulfillment_failure = NULL WHERE id = $1`, [quote.id]);
      res.json({
        message: "Payment accepted - here is your data.",
        tool: quote.tool,
        agreedPrice: quote.agreedPrice,
        data,
        negotiationId: quote.negotiationId,
        round: quote.round,
        payerAddress: quote.payerAddress ?? null,
      });
      return;
    } catch (err) {
      lastError = err as Error;
    }
  }

  // Paid but undelivered after retries - surfaced as a distinct record on
  // the quote (not hidden), rather than pretending the quote never happened.
  const fulfillmentFailure = lastError?.message ?? "Unknown fulfillment error";
  await pool.query(`UPDATE quotes SET fulfillment_failure = $2 WHERE id = $1`, [quote.id, fulfillmentFailure]);
  res.status(502).json({
    error: "Payment succeeded but data fulfillment failed after retries.",
    quoteId: quote.id,
    negotiationId: quote.negotiationId,
    round: quote.round,
    detail: fulfillmentFailure,
  });
}));

// OPEN -> PROCESSING transition. This hook only fires once a real signed
// payment payload has arrived (an unpaid discovery request never reaches
// verifyPayment()), so it cannot wrongly flip state on a plain 402 probe.
// The UPDATE ... WHERE state = 'OPEN' below is a single atomic statement,
// so only one concurrent request can ever match and flip the row -
// Postgres's row-level locking on UPDATE serializes the rest, and a second
// request simply matches zero rows once the first commits.
resourceServer.onBeforeVerify(async (context) => {
  const amountUsdc = Number((context.requirements as any)?.amount ?? 0) / 1_000_000;
  if (amountUsdc > 0 && amountUsdc < 0.001) {
    return { abort: true, reason: "Payment below absolute floor safety net." };
  }

  const quoteId = quoteIdFromContext(context);
  if (!quoteId) {
    return { abort: true, reason: "Payment is not associated with a known quote." };
  }

  const updateResult = await pool.query(
    `UPDATE quotes SET state = 'PROCESSING' WHERE id = $1 AND state = 'OPEN' RETURNING id`,
    [quoteId]
  );
  if (updateResult.rows.length === 0) {
    // Either the quote doesn't exist, or it exists but wasn't OPEN (already
    // claimed by a concurrent request, or already FULFILLED) - re-read
    // (outside the atomic decision above) just to report which, matching
    // the original two distinct error messages.
    const current = await pool.query(`SELECT state FROM quotes WHERE id = $1`, [quoteId]);
    if (current.rows.length === 0) {
      return { abort: true, reason: "Unknown or expired quote." };
    }
    return { abort: true, reason: `Quote is already ${(current.rows[0].state as string).toLowerCase()}.` };
  }
});

// Records the real payer address as soon as it's known - not in
// onAfterSettle, despite that being where FULFILLED is set below. Traced
// through @x402/express's actual middleware source to confirm this: it
// calls next() (running the /pay/:id route handler below, which builds and
// buffers the JSON response body) and only calls processSettlement()
// (which is what fires onAfterSettle) *after* that handler has already
// finished and the response body is fixed - settlement genuinely happens
// after the handler, not before. So onAfterSettle can never get a payer
// address into the handler's own response body; by the time it runs, that
// body was already built with whatever was in Postgres a step earlier.
// onAfterVerify does not have this problem - verifyPayment() (and therefore
// every onAfterVerify hook) is confirmed awaited before next() is ever
// called, and VerifyResponse carries its own real, facilitator-confirmed
// `payer` field (identical value to what settle will later report, since
// both come from the same signed payment payload) - so writing it here
// means the handler's own SELECT sees the real payer already in place.
resourceServer.onAfterVerify(async (context) => {
  const quoteId = quoteIdFromContext(context);
  const payer = context.result.payer;
  if (!quoteId || !payer) return;
  try {
    await pool.query(`UPDATE quotes SET payer_address = $2 WHERE id = $1`, [quoteId, payer]);
  } catch (err) {
    console.error(`Failed to record payer address for quote ${quoteId} after verify:`, err);
  }
});

// PROCESSING -> OPEN recovery: a transient verify/settle failure must not
// permanently lock a quote out of being paid again.
//
// onVerifyFailure/onSettleFailure only fire when the facilitator call
// itself throws - a *different* failure class from a normal settle
// response with success:false, which never throws and so never reaches
// these two hooks - onAfterSettle below is the only hook that sees that
// case, since it runs on every settle attempt regardless of outcome.
//
// These hooks aren't Express routes, so a thrown/rejected DB error here
// wouldn't reach an Express error handler - it would be an unhandled
// rejection, which crashes the whole process. They're wrapped in try/catch
// and log-only: the original failure is already logged above the recovery
// attempt, so a failed recovery is unfortunate (the quote stays PROCESSING)
// but must not take the server down.
resourceServer.onVerifyFailure(async (context) => {
  const quoteId = quoteIdFromContext(context);
  console.error(`[verify threw] quote=${quoteId ?? "unknown"}:`, context.error?.message ?? context.error);
  try {
    await pool.query(`UPDATE quotes SET state = 'OPEN' WHERE id = $1 AND state = 'PROCESSING'`, [quoteId ?? ""]);
  } catch (err) {
    console.error("Failed to recover quote state after verify failure:", err);
  }
});

resourceServer.onSettleFailure(async (context) => {
  const quoteId = quoteIdFromContext(context);
  console.error(`[settle threw] quote=${quoteId ?? "unknown"}:`, context.error?.message ?? context.error);
  try {
    await pool.query(`UPDATE quotes SET state = 'OPEN' WHERE id = $1 AND state = 'PROCESSING'`, [quoteId ?? ""]);
  } catch (err) {
    console.error("Failed to recover quote state after settle failure:", err);
  }
});

// Fires on every settle attempt (success or a normal failed-result
// response) - the real errorReason from the facilitator's settle response
// for the soft-failure case described above. On real success, this is also
// where PROCESSING -> FULFILLED happens, carrying the real payer address
// from the facilitator's own settle response (context.result.payer) - not
// derived or guessed.
resourceServer.onAfterSettle(async (context) => {
  const quoteId = quoteIdFromContext(context);
  if (!quoteId) return;

  if (!context.result.success) {
    console.error(
      `[settle failed] quote=${quoteId} network=${context.result.network}:`,
      context.result.errorReason ?? "(no errorReason provided)"
    );
    try {
      await pool.query(`UPDATE quotes SET state = 'OPEN' WHERE id = $1 AND state = 'PROCESSING'`, [quoteId]);
    } catch (err) {
      console.error("Failed to recover quote state after soft settle failure:", err);
    }
    return;
  }

  try {
    await pool.query(
      `UPDATE quotes SET state = 'FULFILLED', payer_address = $2 WHERE id = $1 AND state = 'PROCESSING'`,
      [quoteId, context.result.payer ?? null]
    );
  } catch (err) {
    console.error(`Failed to mark quote ${quoteId} FULFILLED after real settlement:`, err);
  }
});

// Exported so scripts (e.g. scripts/test-pricing-layer.mjs) can reuse this
// exact function rather than duplicate MCP-calling logic - decide(), the
// TOOLS map, and this function's own body are all otherwise unchanged.
export async function callMcpTool(tool: string, args: Record<string, unknown>): Promise<unknown> {
  const config = TOOLS[tool];
  if (!config) throw new Error(`Unknown tool: ${tool}`);
  const r = await fetch(config.mcpUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name: tool, arguments: args } }),
  });
  if (!r.ok) throw new Error(`MCP server returned ${r.status}`);

  const raw = await r.text();
  const dataLine = raw.split("\n").find((line) => line.startsWith("data:"));
  if (!dataLine) throw new Error(`Unexpected MCP response shape: ${raw.slice(0, 200)}`);
  const json = JSON.parse(dataLine.slice(5).trim()) as { result?: { content?: Array<{ type: string; text?: string }> }; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);

  const content = json.result?.content;
  if (!content || content.length === 0) throw new Error("MCP tool returned no content");
  const text = content[0].text ?? "";
  try { return JSON.parse(text); } catch { return text; }
}

// Falls through to here when an async route handler's promise rejects (see
// asyncHandler) - keeps error responses JSON, consistent with the rest of
// this API, rather than Express's default HTML error page.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled request error:", err);
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error" });
  }
});

async function main() {
  await ensureSchema();

  const PORT = process.env.PORT ?? 3000;
  app.listen(PORT, () => {
    console.log(`Metron listening on http://localhost:${PORT}`);
    console.log(`Seller: ${SELLER_ADDRESS}`);
    console.log(`Settlement: ${NETWORK}, USDC ${BASE_USDC_ADDRESS}`);
    console.log(`Wrapping MCP tool servers: ${BTC_CYCLE_MCP_URL}, ${SHORT_SQUEEZE_MCP_URL}, ${ANALYST_MOMENTUM_MCP_URL}`);
  });
}

// Entry-point guard: only actually boot the HTTP server when this file is
// run directly (`node src/server.ts`), not when it's imported as a module
// for one of its exports (e.g. a script importing callMcpTool). Without
// this, importing callMcpTool would also silently call app.listen() a
// second time and try to bind the same port a real running server already
// holds.
//
// Uses pathToFileURL rather than the common `file://${process.argv[1]}`
// pattern - verified by hand that the naive version never matches on
// Windows (backslash path separators produce a string that is not a valid
// file:// URL, e.g. "file://C:\Users\...\server.ts" vs the real
// import.meta.url "file:///C:/Users/.../server.ts"), which would have
// silently prevented the server from ever starting via `node src/server.ts`
// on this machine.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}
