// Phase 3 standalone test of src/pricingLayer.ts. Two parts:
//  1. A deterministic, LLM-free unit test of clampToPolicy() with a
//     synthetic out-of-bounds proposal - proves the hard-enforcement code
//     path itself works, independent of whether any given LLM call happens
//     to already stay in-bounds.
//  2. Real end-to-end proposeAndNegotiate() calls (real Anthropic calls,
//     real /ask + /quote calls against the real running server, no mocks)
//     across a few sample question/policy combinations, including one with
//     a deliberately-too-low budget, to see what the live system actually
//     does - reported honestly either way, not just the happy path.
import { proposeAndNegotiate, clampToPolicy } from "../src/pricingLayer.ts";

console.log("=== Part 1: clampToPolicy() unit test (deterministic, no LLM) ===");
{
  const policy = { maxBudget: 0.01 };
  const outOfBounds = { openingOffer: 0.5, walkAwayCeiling: 1.2 };
  const result = clampToPolicy(outOfBounds, policy);
  console.log(JSON.stringify({ input: outOfBounds, policy, result }, null, 2));
  const pass =
    result.openingOffer === 0.01 &&
    result.walkAwayCeiling === 0.01 &&
    result.clamped.openingOffer === true &&
    result.clamped.walkAwayCeiling === true;
  console.log(pass ? "PASS: clamp fired correctly on synthetic out-of-bounds input." : "FAIL: clamp did not behave as expected.");

  // Also confirm it does NOT clamp when already in-bounds, so this isn't a
  // trivial always-clamp implementation.
  const inBounds = { openingOffer: 0.002, walkAwayCeiling: 0.008 };
  const result2 = clampToPolicy(inBounds, policy);
  const pass2 =
    result2.openingOffer === 0.002 &&
    result2.walkAwayCeiling === 0.008 &&
    result2.clamped.openingOffer === false &&
    result2.clamped.walkAwayCeiling === false;
  console.log(JSON.stringify({ input: inBounds, policy, result: result2 }, null, 2));
  console.log(pass2 ? "PASS: in-bounds values pass through unclamped." : "FAIL: in-bounds values were incorrectly altered.");
}

const cases = [
  {
    label: "Case A - generous budget, straightforward question",
    question: "What's the current BTC cycle regime?",
    policy: { maxBudget: 0.05 },
  },
  {
    label: "Case B - moderate budget with acceptablePriceRange set",
    question: "What is the current NUPL-based sentiment for bitcoin?",
    policy: { maxBudget: 0.006, acceptablePriceRange: { min: 0.001, max: 0.006 }, minDataFreshness: "24h" },
  },
  {
    label: "Case C - deliberately too-low budget (below the tool's own cost floor) to test clamping in the live system",
    question: "What's the current BTC cycle regime?",
    policy: { maxBudget: 0.0005 },
  },
  {
    label: "Case D - question with no matching tool",
    question: "What's the weather in Tokyo today?",
    policy: { maxBudget: 0.01 },
  },
];

console.log("\n=== Part 2: live end-to-end cases (real Anthropic calls, real running server) ===");
for (const { label, question, policy } of cases) {
  console.log(`\n--- ${label} ---`);
  console.log(`question: ${question}`);
  console.log(`policy: ${JSON.stringify(policy)}`);
  try {
    const result = await proposeAndNegotiate(question, policy);
    console.log(JSON.stringify(result, null, 2));
    if (result.ok) {
      console.log(
        `SUMMARY: tool=${result.tool} openingOffer=${result.openingOffer} walkAwayCeiling=${result.walkAwayCeiling} ` +
          `clamped=${JSON.stringify(result.reasoningRecord.clamped)} -> decide() said: ${result.quote.decision} (${result.quote.reason})`
      );
    } else {
      console.log(`SUMMARY: not answered - ${result.reason}`);
    }
  } catch (err) {
    console.log(`ERROR: ${err?.message ?? err}`);
  }
}
