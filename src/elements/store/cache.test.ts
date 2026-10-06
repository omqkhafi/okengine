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
  tier1FlowDims,
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
  test("pure store reads cache by default; side effects never cache", () => {
    const reads: Effects = { reads: ["sql:notes"] };
    expect(autoCacheEligible({ effects: reads })).toBe(true);
    expect(autoCacheEligible({ auto: false, effects: reads })).toBe(false);
    expect(autoCacheEligible({ auto: false, cache: true, effects: reads })).toBe(true);
    expect(autoCacheEligible({ auto: true, effects: reads })).toBe(true);
    expect(autoCacheEligible({ cache: true, effects: reads })).toBe(true);
    expect(autoCacheEligible({ cache: "30s", effects: reads })).toBe(true);
    expect(autoCacheEligible({ auto: true, cache: false, effects: reads })).toBe(false);
    expect(autoCacheEligible({ cache: true, durable: true, effects: reads })).toBe(false);
    expect(
      autoCacheEligible({ cache: true, effects: { reads: ["sql:notes"], writes: ["sql:notes"] } }),
    ).toBe(false);
    expect(
      autoCacheEligible({ cache: true, effects: { reads: ["sql:notes"], asks: ["task-suggest"] } }),
    ).toBe(false);
    for (const extra of [
      { emits: ["note.created"] },
      { sends: ["welcome"] },
      { fetches: ["api.example.com"] },
      { secrets: ["stripe"] },
      { calls: ["notes.create"] },
      { embeds: ["embed-small"] },
      { decides: ["route"] },
    ]) {
      expect(autoCacheEligible({ auto: true, effects: { reads: ["sql:notes"], ...extra } })).toBe(
        false,
      );
    }
    expect(autoCacheEligible({ auto: true, effects: { reads: ["runs"] } })).toBe(false);
    expect(autoCacheEligible({ auto: true, effects: { reads: ["signal:notify"] } })).toBe(false);
    expect(autoCacheEligible({ auto: true, effects: { reads: ["sql:notes", "runs"] } })).toBe(
      false,
    );
    expect(autoCacheEligible({ auto: true, effects: {} })).toBe(false);
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

  test("effectsFromLedger keeps store effects and side effects, including non-store reads", () => {
    expect(
      effectsFromLedger([
        { kind: "read", resource: "sql:views" },
        { kind: "read", resource: "sql:views" },
        { kind: "read", resource: "runs" },
        { kind: "read", resource: "signal:notify" },
        { kind: "write", resource: "sql:views" },
        { kind: "ask", resource: "summarize" },
        { kind: "emit", resource: "view-changed" },
        { kind: "send", resource: "welcome" },
        { kind: "fetch", resource: "api.example.com" },
        { kind: "secret", resource: "stripe" },
        { kind: "call", resource: "notes.create" },
        { kind: "embed", resource: "embed-small" },
        { kind: "decide", resource: "route" },
      ]),
    ).toEqual({
      reads: ["sql:views", "runs", "signal:notify"],
      writes: ["sql:views"],
      asks: ["summarize"],
      emits: ["view-changed"],
      sends: ["welcome"],
      fetches: ["api.example.com"],
      secrets: ["stripe"],
      calls: ["notes.create"],
      embeds: ["embed-small"],
      decides: ["route"],
    });
  });

  test("tier-1 dims always include tenant, locale, scopes, and roles", () => {
    const effects: Effects = { reads: ["sql:notes"] };
    const a = tier1FlowDims(
      "notes.list",
      {},
      {
        userId: "u1",
        tenantId: "ta",
        locale: "en",
        scopes: ["b", "a"],
        roles: ["admin"],
      },
    );
    const b = tier1FlowDims(
      "notes.list",
      {},
      {
        userId: "u1",
        tenantId: "tb",
        locale: "en",
        scopes: ["a", "b"],
        roles: ["admin"],
      },
    );
    const locale = tier1FlowDims(
      "notes.list",
      {},
      {
        userId: "u1",
        tenantId: "ta",
        locale: "ar",
        scopes: ["a", "b"],
        roles: ["member"],
      },
    );
    expect(a).toContain("t:ta");
    expect(a).toContain("l:en");
    expect(a).toContain("s:a,b");
    expect(a).toContain("r:admin");
    expect(a).not.toEqual(b);
    expect(
      tier1DimsByResource(
        effects,
        "notes.list",
        {},
        {
          userId: "u1",
          tenantId: "ta",
          locale: "en",
          scopes: ["a"],
          roles: ["admin"],
        },
      )["sql:notes"],
    ).not.toEqual(
      tier1DimsByResource(
        effects,
        "notes.list",
        {},
        {
          userId: "u1",
          tenantId: "ta",
          locale: "ar",
          scopes: ["a"],
          roles: ["member"],
        },
      )["sql:notes"],
    );
    expect(locale).toContain("l:ar");
    expect(locale).toContain("r:member");
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
