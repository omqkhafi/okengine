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
  autoCacheEligible,
  computedCacheKey,
  createStoreCache,
  effectsFromLedger,
  isInvalidatedByWrite,
  resolveCacheEffects,
  tier1DimsByResource,
  tier1KeysForReads,
  tier1Lookup,
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

  test("write to table A does not invalidate a cached read of table B in the same sql store", () => {
    // Two tables under one `store.sql("app", …)` — the exact shape Direction
    // B's per-table kernel resolution (fx.ts `gatedTable`) now produces:
    // `sql:notes` / `sql:orders`, not the old coarse `sql:app` for both.
    // This precision was already correct in cache.ts before Direction B —
    // it simply never received per-table refs to prove it with. Confirmed
    // here with the exact naming the kernel now emits.
    const cache = createStoreCache();
    const notesRead: Effects = { reads: ["sql:notes"] };
    const keys = tier1KeysForReads(notesRead);

    cache.set({
      tier: 1,
      key: keys[0]!,
      value: [{ id: "n1" }],
      resources: ["sql:notes"],
      expiresAt: null,
    });

    // A write to "orders" — a different table, same store — must not touch it.
    expect(cache.invalidateFromEffects({ writes: ["sql:orders"] }).keys).toEqual([]);
    expect(cache.get(keys[0]!)).toBeDefined();

    // A write to "notes" itself still invalidates.
    expect(cache.invalidateFromEffects({ writes: ["sql:notes"] }).keys).toEqual(keys);
    expect(cache.get(keys[0]!)).toBeUndefined();
  });
});

describe("autoCacheEligible", () => {
  test("read-only flows cache by default; mutations / asks / durable / cache:false do not", () => {
    expect(autoCacheEligible({ effects: { reads: ["sql:notes"] } })).toBe(true);
    expect(autoCacheEligible({ cache: true, effects: { reads: ["sql:notes"] } })).toBe(true);
    expect(autoCacheEligible({ cache: "30s", effects: { reads: ["sql:notes"] } })).toBe(true);
    expect(autoCacheEligible({ cache: false, effects: { reads: ["sql:notes"] } })).toBe(false);
    expect(autoCacheEligible({ durable: true, effects: { reads: ["sql:notes"] } })).toBe(false);
    expect(autoCacheEligible({ effects: { reads: ["sql:notes"], writes: ["sql:notes"] } })).toBe(
      false,
    );
    expect(autoCacheEligible({ effects: { reads: ["sql:notes"], asks: ["task-suggest"] } })).toBe(
      false,
    );
    expect(autoCacheEligible({ effects: { reads: ["runs"] } })).toBe(false);
    expect(autoCacheEligible({ effects: {} })).toBe(false);
  });

  test("flow+input dims keep list and get from colliding; invalidation still uses the resource", () => {
    const effects: Effects = { reads: ["sql:views"] };
    const listDims = tier1DimsByResource(effects, "views.list", {});
    const getDims = tier1DimsByResource(effects, "views.get", { id: "v1" });
    const listKeys = tier1KeysForReads(effects, listDims);
    const getKeys = tier1KeysForReads(effects, getDims);
    expect(listKeys[0]).not.toEqual(getKeys[0]);
    expect(isInvalidatedByWrite(listKeys[0]!, { writes: ["sql:views"] })).toBe(true);
    expect(isInvalidatedByWrite(getKeys[0]!, { writes: ["sql:views"] })).toBe(true);
  });

  test("effectsFromLedger keeps store reads/writes and asks; drops runs", () => {
    expect(
      effectsFromLedger([
        { kind: "read", resource: "sql:views" },
        { kind: "read", resource: "sql:views" },
        { kind: "read", resource: "runs" },
        { kind: "write", resource: "sql:views" },
        { kind: "ask", resource: "summarize" },
        { kind: "emit", resource: "view-changed" },
      ]),
    ).toEqual({
      reads: ["sql:views"],
      writes: ["sql:views"],
      asks: ["summarize"],
    });
  });

  test("resolveCacheEffects prefers stamped reads, then learned reads", () => {
    expect(resolveCacheEffects({ reads: ["sql:views"] }, ["sql:tasks"])).toEqual({
      reads: ["sql:views"],
    });
    expect(resolveCacheEffects({}, ["sql:views"])).toEqual({ reads: ["sql:views"] });
    expect(resolveCacheEffects(undefined, undefined)).toEqual({});
  });

  test("tier1Lookup misses when any contributing key is gone", () => {
    const cache = createStoreCache();
    cache.set({
      tier: 1,
      key: "a",
      value: 1,
      resources: ["sql:views"],
      expiresAt: null,
    });
    expect(tier1Lookup((key) => cache.get<number>(key), ["a", "b"])).toBeUndefined();
    cache.set({
      tier: 1,
      key: "b",
      value: 1,
      resources: ["sql:sections"],
      expiresAt: null,
    });
    expect(tier1Lookup((key) => cache.get<number>(key), ["a", "b"])).toBe(1);
  });
});
