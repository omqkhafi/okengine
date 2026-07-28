/**
 * Tier-1 cache exactness lock — invalidation keys off declared resources.
 *
 * A write invalidates a cached read only when the written resource appears
 * in that read's `effects.reads`. A read that recorded only its root table
 * is NOT invalidated by a write to a related table — which is exactly why
 * relational `with:` is not exposed through `fx` (silent staleness hazard).
 */

import { describe, expect, test } from "bun:test";
import type { Effects } from "../../manifest/types.ts";
import {
  computedCacheKey,
  createStoreCache,
  isInvalidatedByWrite,
  tier1KeysForReads,
} from "./cache.ts";

describe("tier-1 cache — exact per-resource invalidation (path b)", () => {
  test("a write invalidates only reads that declared the written resource", () => {
    const cache = createStoreCache();

    // Root-only read — what a half-shipped `with:` expansion would record.
    const rootOnly: Effects = { reads: ["sql:links"] };
    const keys = tier1KeysForReads(rootOnly);
    expect(keys).toEqual([computedCacheKey("sql:links")]);

    cache.set({
      tier: 1,
      key: keys[0]!,
      value: [{ id: "l1" }],
      resources: ["sql:links"],
      expiresAt: null,
    });

    // A write to the related table does not invalidate the root-only read.
    expect(isInvalidatedByWrite(keys[0]!, { writes: ["sql:daily"] })).toBe(false);
    expect(cache.invalidateFromEffects({ writes: ["sql:daily"] }).keys).toEqual([]);
    expect(cache.get(keys[0]!)).toBeDefined();

    // Exact match on the declared resource still invalidates.
    expect(isInvalidatedByWrite(keys[0]!, { writes: ["sql:links"] })).toBe(true);
    expect(cache.invalidateFromEffects({ writes: ["sql:links"] }).keys).toEqual(keys);
    expect(cache.get(keys[0]!)).toBeUndefined();
  });
});
