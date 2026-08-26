#!/usr/bin/env node
// Live end-to-end test: POST /quote -> unpaid GET /pay/:id (assert real 402
// shape) -> real signed x402 payment via Coinbase's hosted facilitator ->
// assert the real 200 shape and settlement details.
//
// Network-agnostic: reads TEST_NETWORK/TEST_USDC_ADDRESS so the same script
// runs against whatever network the server itself is currently configured
// for. Defaults to Base mainnet - the same "no env vars = mainnet"
// convention as src/server.ts and web/src/lib/payX402.ts - so this matches
// the server's own default with zero flags; override both together to
// point at Base Sepolia instead.
//
// This CANNOT be run from a sandboxed environment with no route to
// api.cdp.coinbase.com - it needs real outbound internet access to
// Coinbase's CDP API. Run it from a normal machine or CI runner.
//
// Preconditions (all real, none of this is simulated):
//   1. The Metron server (src/server.ts) must be running, configured for
//      the SAME network as TEST_NETWORK/TEST_USDC_ADDRESS below (mainnet -
//      the default on both sides - needs no env vars on either the server
//      or this script; Sepolia needs X402_NETWORK/X402_USDC_ADDRESS set on
//      the server AND TEST_NETWORK/TEST_USDC_ADDRESS set here, together).
//      (CDP_API_KEY_ID/CDP_API_KEY_SECRET must already be set in .env for
//      the facilitator's verify/settle calls to authenticate.)
//   2. TEST_BUYER_PRIVATE_KEY must be a real private key. For a genuine
//      settlement it needs to hold real USDC on the target network - but a
//      fresh, zero-balance key is enough to test how far the facilitator
//      gets before rejecting (e.g. distinguishing an account/verification
//      gate from an ordinary insufficient-balance failure). No ETH is
//      needed on this wallet at any funding level - EIP-3009 "exact"
//      payments are a signed authorization, not a broadcast transaction;
//      the facilitator submits the actual settlement transaction itself.
//
// Usage (mainnet, the default - matches a plain `npm start`):
//   TEST_BUYER_PRIVATE_KEY=0x... \
//   node --experimental-transform-types --no-warnings scripts/test-x402-sepolia.mjs
//
// Usage (Base Sepolia, both sides need the override):
//   TEST_BUYER_PRIVATE_KEY=0x... TEST_NETWORK=eip155:84532 \
//   TEST_USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e \
//   node --experimental-transform-types --no-warnings scripts/test-x402-sepolia.mjs
//
// Every assertion below is against a real HTTP response from a real running
// server talking to a real facilitator - nothing here is mocked. A failure
// is reported as a failure, not swallowed.

import { privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";

const NEGOTIATOR_URL = process.env.NEGOTIATOR_URL ?? "http://localhost:3000";
const TARGET_NETWORK = process.env.TEST_NETWORK ?? "eip155:8453";
const TARGET_USDC_ADDRESS = process.env.TEST_USDC_ADDRESS ?? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TEST_BUYER_PRIVATE_KEY = process.env.TEST_BUYER_PRIVATE_KEY;

if (!TEST_BUYER_PRIVATE_KEY) {
  console.error("Missing TEST_BUYER_PRIVATE_KEY - see this script's header comment for what's required.");
  process.exit(1);
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${name}${detail ? ` (${detail})` : ""}`);
}

async function main() {
  console.log(`[harness] Target: ${NEGOTIATOR_URL}, network: ${TARGET_NETWORK}\n`);

  // --- Step 0: confirm the server itself is actually configured for the
  // target network before testing anything - a mismatched server would make every
  // later assertion meaningless.
  const pricing = await (await fetch(`${NEGOTIATOR_URL}/pricing`)).json();
  console.log("[harness] GET /pricing:", JSON.stringify(pricing));
  record(
    "Server is configured for the target network",
    pricing.network === TARGET_NETWORK,
    `got network=${pricing.network}`
  );
  const sellerAddress = pricing.sellerAddress;

  // --- Step 1: negotiate a real quote (propose at ask price for a
  // guaranteed single-round accept - this test is about payment, not
  // negotiation logic, which is already covered elsewhere).
  const tool = "get_nupl_sentiment";
  const askPrice = pricing.tools.find((t) => t.tool === tool)?.askPrice;
  const quoteRes = await fetch(`${NEGOTIATOR_URL}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, proposedPrice: askPrice }),
  });
  const quote = await quoteRes.json();
  console.log("\n[harness] POST /quote:", JSON.stringify(quote));
  record("POST /quote returns accept", quote.decision === "accept", `decision=${quote.decision}`);
  record("Quote has a quoteId", typeof quote.quoteId === "string" && quote.quoteId.length > 0);

  const payUrl = `${NEGOTIATOR_URL}/pay/${quote.quoteId}`;

  // --- Step 2: unpaid request - the real 402 shape, decoded with the SDK's
  // own decoder (not hand-rolled base64/JSON parsing), which is exactly
  // what web/src/lib/payX402.ts relies on the SDK to do internally.
  const unpaidRes = await fetch(payUrl);
  const paymentRequiredHeader = unpaidRes.headers.get("PAYMENT-REQUIRED");
  console.log(`\n[harness] Unpaid GET /pay/:id -> HTTP ${unpaidRes.status}`);
  record("Unpaid request returns 402", unpaidRes.status === 402, `got ${unpaidRes.status}`);
  record("PAYMENT-REQUIRED header is present", !!paymentRequiredHeader);

  if (paymentRequiredHeader) {
    const decoded = decodePaymentRequiredHeader(paymentRequiredHeader);
    console.log("[harness] Decoded PAYMENT-REQUIRED:", JSON.stringify(decoded, null, 2));
    const accept = Array.isArray(decoded.accepts) ? decoded.accepts[0] : decoded.accepts;
    record("x402Version is present", typeof decoded.x402Version === "number", `got ${decoded.x402Version}`);
    record("scheme is 'exact'", accept?.scheme === "exact", `got ${accept?.scheme}`);
    record("network matches the target network", accept?.network === TARGET_NETWORK, `got ${accept?.network}`);
    record(
      "asset matches the target USDC address",
      accept?.asset?.toLowerCase() === TARGET_USDC_ADDRESS.toLowerCase(),
      `got ${accept?.asset}`
    );
    record("payTo matches the real seller address", accept?.payTo?.toLowerCase() === sellerAddress?.toLowerCase());
    const expectedAmount = String(Math.round(quote.agreedPrice * 1_000_000));
    record("amount matches the agreed price (micro-USDC)", accept?.amount === expectedAmount, `expected ${expectedAmount}, got ${accept?.amount}`);
  }

  // --- Step 3: the real payment - same SDK primitives web/src/lib/payX402.ts
  // and buyer-agent/index.ts use, signed by a real funded wallet on the target network.
  const account = privateKeyToAccount(TEST_BUYER_PRIVATE_KEY);
  console.log(`\n[harness] Paying as ${account.address}...`);
  const client = new x402Client().register(TARGET_NETWORK, new ExactEvmScheme(account));
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  let paidRes;
  try {
    paidRes = await fetchWithPayment(payUrl);
  } catch (err) {
    record("Real payment completes without throwing", false, err?.message ?? String(err));
    printSummaryAndExit();
    return;
  }

  console.log(`[harness] Paid GET /pay/:id -> HTTP ${paidRes.status}`);
  record("Paid request returns 200", paidRes.status === 200, `got ${paidRes.status}`);

  const paymentResponseHeader = paidRes.headers.get("PAYMENT-RESPONSE");
  record("PAYMENT-RESPONSE header is present", !!paymentResponseHeader);

  let settleResponse = null;
  if (paymentResponseHeader) {
    const httpClient = new x402HTTPClient(client);
    settleResponse = httpClient.getPaymentSettleResponse((name) => paidRes.headers.get(name));
    console.log("[harness] Decoded PAYMENT-RESPONSE (real settlement):", JSON.stringify(settleResponse, null, 2));
    record("Settlement reports success", settleResponse.success === true, `success=${settleResponse.success}, errorReason=${settleResponse.errorReason}`);
    record("Settlement network matches the target network", settleResponse.network === TARGET_NETWORK, `got ${settleResponse.network}`);
    record(
      "Real payer matches the signing wallet",
      settleResponse.payer?.toLowerCase() === account.address.toLowerCase(),
      `got ${settleResponse.payer}`
    );
    record(
      "Real settlement transaction hash present",
      /^0x[0-9a-fA-F]{64}$/.test(settleResponse.transaction ?? ""),
      `got ${settleResponse.transaction}`
    );
  }

  const body = await paidRes.json();
  console.log("[harness] Paid response body:", JSON.stringify(body, null, 2));
  record("Response body has the real tool data", body.data !== undefined && body.data !== null);
  record("Response body payerAddress matches the signing wallet", body.payerAddress?.toLowerCase() === account.address.toLowerCase());

  // --- Step 4: cross-check against /activity - confirms the resourceServer's
  // onAfterSettle hook actually flipped Postgres state for real, not just
  // that the HTTP response looked right.
  const activity = await (await fetch(`${NEGOTIATOR_URL}/activity?limit=10`)).json();
  const activityRow = activity.find((r) => r.quoteId === quote.quoteId);
  console.log("\n[harness] Matching /activity row:", JSON.stringify(activityRow));
  record("Quote is FULFILLED in /activity", activityRow?.state === "FULFILLED", `got ${activityRow?.state}`);
  record(
    "/activity payerAddress matches the real payer",
    activityRow?.payerAddress?.toLowerCase() === account.address.toLowerCase()
  );

  printSummaryAndExit();
}

function printSummaryAndExit() {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== ${results.length - failed.length}/${results.length} assertions passed ===`);
  if (failed.length > 0) {
    console.log("Failed:");
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ""}`);
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[harness] Fatal error:", err);
  process.exit(1);
});
