// Standalone unit test for src/reasoningHash.ts - no network, no LLM, no
// server. Proves: the same logical object, built with different key
// insertion orders (including nested objects), always canonicalizes to the
// same string and hashes to the same keccak256 value.
import { canonicalize, hashReasoningRecord } from "../src/reasoningHash.ts";

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"}: ${label}`);
  if (!condition) failures++;
}

// Same logical reasoningRecord-shaped object, two different construction
// orders (including nested "policy" and "clamped" objects built key-reversed).
const recordA = {
  policy: { maxBudget: 0.05, minDataFreshness: "24h", acceptablePriceRange: { min: 0.001, max: 0.05 } },
  question: "What's the current BTC cycle regime?",
  tool: "get_btc_cycle_regime",
  toolSelectionReasoning: "Directly matches.",
  toolPriceRange: { costFloor: 0.003, askPrice: 0.008 },
  pricingReasoning: "Opening between floor and ask.",
  openingOfferRaw: 0.004,
  walkAwayCeilingRaw: 0.045,
  openingOffer: 0.004,
  walkAwayCeiling: 0.045,
  clamped: { openingOffer: false, walkAwayCeiling: false },
  timestamp: "2026-08-19T14:26:26.986Z",
};

const recordB = {
  timestamp: "2026-08-19T14:26:26.986Z",
  clamped: { walkAwayCeiling: false, openingOffer: false },
  walkAwayCeiling: 0.045,
  openingOffer: 0.004,
  walkAwayCeilingRaw: 0.045,
  openingOfferRaw: 0.004,
  pricingReasoning: "Opening between floor and ask.",
  toolPriceRange: { askPrice: 0.008, costFloor: 0.003 },
  toolSelectionReasoning: "Directly matches.",
  tool: "get_btc_cycle_regime",
  question: "What's the current BTC cycle regime?",
  policy: { acceptablePriceRange: { max: 0.05, min: 0.001 }, minDataFreshness: "24h", maxBudget: 0.05 },
};

const canonA = canonicalize(recordA);
const canonB = canonicalize(recordB);
console.log("canonical A:", canonA);
console.log("canonical B:", canonB);
check("canonical JSON is identical regardless of key insertion order (including nested objects)", canonA === canonB);

const hashA = hashReasoningRecord(recordA);
const hashB = hashReasoningRecord(recordB);
console.log("hash A:", hashA.hash);
console.log("hash B:", hashB.hash);
check("hash is identical for the two differently-ordered constructions", hashA.hash === hashB.hash);
check("hash looks like a bytes32 hex string (0x + 64 hex chars)", /^0x[0-9a-f]{64}$/.test(hashA.hash));

// Simulates a Postgres JSONB round trip: JSON.parse(JSON.stringify(x)) does
// not preserve any particular key order guarantee either, so this exercises
// the same "arbitrary order back out" scenario a real re-fetch would.
const roundTripped = JSON.parse(JSON.stringify(recordA));
const hashRoundTrip = hashReasoningRecord(roundTripped);
check("hash survives a JSON.parse(JSON.stringify()) round trip unchanged", hashRoundTrip.hash === hashA.hash);

// A record that differs in exactly one nested value must NOT hash the same.
const recordC = { ...recordA, policy: { ...recordA.policy, maxBudget: 0.06 } };
const hashC = hashReasoningRecord(recordC);
check("a record that genuinely differs produces a different hash (not a trivial always-equal bug)", hashC.hash !== hashA.hash);

// Arrays: order must be preserved (not sorted) since array order is semantic.
const arrRecord1 = { tags: ["b", "a", "c"] };
const arrRecord2 = { tags: ["b", "a", "c"] };
const arrRecord3 = { tags: ["a", "b", "c"] };
check(
  "identical array order hashes the same",
  hashReasoningRecord(arrRecord1).hash === hashReasoningRecord(arrRecord2).hash
);
check(
  "different array order hashes differently (arrays are not key-sorted)",
  hashReasoningRecord(arrRecord1).hash !== hashReasoningRecord(arrRecord3).hash
);

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} CHECK(S) FAILED`}`);
if (failures > 0) process.exit(1);
