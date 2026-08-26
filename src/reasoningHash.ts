/**
 * Canonical JSON serialization + keccak256 hashing for reasoningRecord
 * objects (see pricingLayer.ts). The reasoning-hash commitment mechanism
 * (architecture.md) only works if the same logical record always produces
 * the same hash, regardless of the key insertion order it happened to be
 * built with - a JS object literal's key order and a JSON.parse()'d object
 * coming back out of Postgres JSONB are not guaranteed to match otherwise.
 *
 * This module does no hashing of anything beyond what it's given - it does
 * not know about openDeal, Postgres, or the contract. It is a pure,
 * side-effect-free utility, deliberately kept that small so "does the same
 * object always hash the same way" is trivial to verify in isolation (see
 * scripts/test-reasoning-hash.mjs).
 */

import { keccak256, stringToHex } from "viem";

/**
 * Recursively rebuilds every plain object in `value` with its keys sorted
 * alphabetically, leaving arrays' element order untouched (array order is
 * semantically meaningful - e.g. it is never correct to reorder it) and
 * primitives untouched. JSON.stringify on the result then preserves this
 * sorted order deterministically, since JS objects preserve string-key
 * insertion order and JSON.stringify iterates in that order.
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      sorted[key] = sortKeysDeep(input[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Canonical JSON string for `value` - same logical object in, same string
 * out, regardless of original key order. Keys with an `undefined` value are
 * dropped by JSON.stringify itself (standard JS behavior), which is fine
 * here since a value that was never set is indistinguishable from one that
 * round-tripped through Postgres JSONB without ever having that key.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

export interface ReasoningHashResult {
  canonicalJson: string;
  hash: `0x${string}`;
}

/**
 * Canonicalizes `record` and returns both the canonical JSON string (what
 * actually gets stored, so a verifier re-hashes the exact same bytes) and
 * its keccak256 hash as a bytes32-ready hex string - this is the
 * `reasoningHash` value server.ts stores and serves via
 * GET /reasoning/:negotiationId (an off-chain audit record - see that
 * endpoint's own comment for why there is no on-chain commitment under the
 * x402/Base flow).
 */
export function hashReasoningRecord(record: unknown): ReasoningHashResult {
  const canonicalJson = canonicalize(record);
  const hash = keccak256(stringToHex(canonicalJson));
  return { canonicalJson, hash };
}
