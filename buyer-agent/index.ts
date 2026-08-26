import { privateKeyToAccount } from "viem/accounts";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";

const NEGOTIATOR_URL = process.env.NEGOTIATOR_URL ?? "http://localhost:3000";
const BASE_NETWORK = "eip155:8453";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  return {
    // Default tool matches the on-chain intelligence provider (BTC Cycle
    // Intelligence) - the current, live, single-seller scope. Squeeze-tool
    // args below are only exercised if a squeeze tool name is explicitly
    // passed via --tool.
    tool: get("--tool", "get_btc_cycle_regime"),
    ticker: get("--ticker", "GME"),
    ticker1: get("--ticker1", "CVNA"),
    ticker2: get("--ticker2", "GME"),
    maxBudget: parseFloat(get("--max-budget", "0.01")),
    // Negotiate but stop before actually paying. Also implied when
    // BUYER_PRIVATE_KEY is unset, so negotiation can be exercised without a
    // funded wallet on hand.
    dryRun: args.includes("--dry-run"),
  };
}
const { tool, ticker, ticker1, ticker2, maxBudget, dryRun } = parseArgs();

const BUYER_PRIVATE_KEY = process.env.BUYER_PRIVATE_KEY as `0x${string}` | undefined;

if (!dryRun && !BUYER_PRIVATE_KEY) {
  console.error(
    "Missing BUYER_PRIVATE_KEY — set it to a funded Base mainnet wallet's private key (needs real USDC), or pass --dry-run to test negotiation only."
  );
  process.exit(1);
}

function argsForTool(t: string): Record<string, unknown> {
  if (t === "compare_squeeze_risk") return { ticker1, ticker2 };
  if (["get_squeeze_risk", "get_short_interest", "get_cost_to_borrow", "get_short_interest_trend"].includes(t)) {
    return { ticker };
  }
  return {};
}

function initialOffer(maxBudget: number): number {
  return Number((maxBudget * 0.5).toFixed(6));
}

interface QuoteResponse {
  decision: "accept" | "reject" | "counter";
  quoteId?: string;
  agreedPrice?: number;
  reason: string;
  negotiationId: string;
  round: number;
}

async function negotiate(): Promise<{ quoteId: string; agreedPrice: number; negotiationId: string; round: number } | null> {
  const args = argsForTool(tool);
  let offer = initialOffer(maxBudget);
  let attempt = 0;
  const MAX_ATTEMPTS = 3;
  // Undefined on the first call so the server mints one; every call after
  // that echoes it back so the server can track/enforce rounds server-side.
  let negotiationId: string | undefined;

  console.log(`[buyer-agent] Task: ${tool}(${JSON.stringify(args)}), max budget: $${maxBudget}`);

  while (attempt < MAX_ATTEMPTS) {
    attempt++;
    console.log(`[buyer-agent] Attempt ${attempt}: proposing $${offer.toFixed(6)}`);

    const res = await fetch(`${NEGOTIATOR_URL}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, args, proposedPrice: offer, ...(negotiationId ? { negotiationId } : {}) }),
    });
    const quote = (await res.json()) as QuoteResponse;
    negotiationId = quote.negotiationId;

    console.log(
      `[buyer-agent] [negotiation ${negotiationId} round ${quote.round}] Seller decided: ${quote.decision} — ${quote.reason}`
    );

    if (quote.decision === "accept") {
      return { quoteId: quote.quoteId!, agreedPrice: quote.agreedPrice!, negotiationId, round: quote.round };
    }
    if (quote.decision === "reject") {
      console.log("[buyer-agent] Seller rejected outright. Walking away — no deal.");
      return null;
    }

    const countered = quote.agreedPrice!;
    if (countered <= maxBudget) {
      console.log(`[buyer-agent] Counter of $${countered.toFixed(6)} is within budget — re-proposing.`);
      offer = countered;
    } else {
      console.log(`[buyer-agent] Counter of $${countered.toFixed(6)} exceeds max budget $${maxBudget} — walking away.`);
      return null;
    }
  }

  console.log("[buyer-agent] Max negotiation attempts reached without a deal.");
  return null;
}

async function main() {
  const deal = await negotiate();
  if (!deal) {
    console.log("[buyer-agent] No purchase made.");
    return;
  }

  console.log(
    `[buyer-agent] Deal reached at $${deal.agreedPrice.toFixed(6)} (negotiationId=${deal.negotiationId}, round=${deal.round}).`
  );

  if (dryRun || !BUYER_PRIVATE_KEY) {
    console.log("[buyer-agent] Dry run - stopping before payment. No payment call was made.");
    return;
  }

  console.log(`[buyer-agent] Paying via x402 (${BASE_NETWORK}, Base mainnet)...`);

  // A raw viem LocalAccount already satisfies ClientEvmSigner ({ address,
  // signTypedData(...) }) directly - no wrapper needed for a Node-side CLI
  // holding its own private key (unlike the browser wallet flow in
  // web/src/lib/payX402.ts, which adapts an injected wallet's WalletClient
  // instead of a raw key).
  const account = privateKeyToAccount(BUYER_PRIVATE_KEY);
  const client = new x402Client().register(BASE_NETWORK, new ExactEvmScheme(account));
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  const started = Date.now();
  const res = await fetchWithPayment(`${NEGOTIATOR_URL}/pay/${deal.quoteId}`);
  const elapsedMs = Date.now() - started;
  const data = await res.json();

  console.log(`[buyer-agent] Payment complete in ${elapsedMs}ms. HTTP status: ${res.status}`);
  console.log("[buyer-agent] Data received:", JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error("[buyer-agent] Fatal error:", err);
  process.exit(1);
});
