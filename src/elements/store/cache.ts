/**
 * Three cache tiers.
 *
 * - Tier 1 — automatic for live / read flows; invalidation computed from effects
 * - Tier 2 — a flag on any flow (`cache: "5m"`)
 * - Tier 3 — manual via `fx.cache.getOrSet`
 */

import type { Effects, ResourceRef } from "../../manifest/types.ts";

/** Cache tier identifiers. */
export type CacheTier = 1 | 2 | 3;

/** One cached entry with its provenance. */
export interface CacheEntry<T = unknown> {
  readonly tier: CacheTier;
  readonly key: string;
  readonly value: T;
  /** Resources this entry was derived from (tier 1). */
  readonly resources: readonly ResourceRef[];
  /** Absolute expiry epoch-ms, or null for no TTL. */
  readonly expiresAt: number | null;
}

/** Invalidation event produced by a write. */
export interface InvalidationEvent {
  /** Resources written. */
  readonly resources: readonly ResourceRef[];
  /** Keys removed. */
  readonly keys: readonly string[];
}

/**
 * Compute the tier-1 cache key for a read effect set.
 *
 * Format: `computed:{resource}` or `computed:{resource}/{dim}` when dims given.
 *
 * @param resource - Store resource ref
 * @param dims - Optional dimension suffixes (e.g. `userId`)
 */
export function computedCacheKey(resource: ResourceRef, dims?: readonly string[]): string {
  if (!dims || dims.length === 0) return `computed:${resource}`;
  return `computed:${resource}/${dims.join("/")}`;
}

/**
 * Tier-1 keys implied by a read effect set.
 *
 * @param effects - Flow effects (must include reads)
 * @param dimsByResource - Optional per-resource dimension suffixes
 */
export function tier1KeysForReads(
  effects: Effects,
  dimsByResource?: Readonly<Record<string, readonly string[]>>,
): string[] {
  const reads = (effects.reads ?? []).filter((r): r is ResourceRef => r !== "runs");
  return reads.map((resource) => computedCacheKey(resource, dimsByResource?.[resource]));
}

/**
 * Resources whose tier-1 entries a write must invalidate.
 *
 * @param effects - Write flow effects
 */
export function resourcesTouchedByWrites(effects: Effects): ResourceRef[] {
  return [...(effects.writes ?? [])];
}

/**
 * Whether a tier-1 key is invalidated by a write effect set.
 *
 * Auto-invalidation fires on exactly the writes touching the read's keys.
 *
 * @param key - Tier-1 cache key (`computed:…`)
 * @param writeEffects - Effects of the writing flow
 */
export function isInvalidatedByWrite(key: string, writeEffects: Effects): boolean {
  if (!key.startsWith("computed:")) return false;
  const body = key.slice("computed:".length);
  const resource = body.split("/")[0] ?? "";
  return (writeEffects.writes ?? []).some((w) => w === resource);
}

/** In-memory multi-tier cache used by the store runtime and tests. */
export interface StoreCache {
  /**
   * Get a value by key.
   *
   * @param key - Cache key
   */
  get<T = unknown>(key: string): T | undefined;
  /**
   * Set a value.
   *
   * @param entry - Entry to store
   */
  set<T>(entry: CacheEntry<T>): void;
  /**
   * Invalidate every tier-1 entry whose resources intersect `resources`.
   *
   * @param resources - Written resources
   */
  invalidate(resources: readonly ResourceRef[]): InvalidationEvent;
  /**
   * Apply write effects: invalidate exactly the keys those writes touch.
   *
   * @param writeEffects - Writing flow's effects
   */
  invalidateFromEffects(writeEffects: Effects): InvalidationEvent;
  /** Snapshot of keys currently held. */
  keys(): string[];
  /** Clear all tiers. */
  clear(): void;
}

/**
 * Create an in-memory store cache (all three tiers share one map; tier is metadata).
 *
 * @param now - Clock for TTL expiry
 */
export function createStoreCache(now: () => number = () => Date.now()): StoreCache {
  const entries = new Map<string, CacheEntry>();

  function alive(entry: CacheEntry): boolean {
    return entry.expiresAt === null || entry.expiresAt > now();
  }

  return {
    get<T = unknown>(key: string): T | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (!alive(entry)) {
        entries.delete(key);
        return undefined;
      }
      return entry.value as T;
    },
    set<T>(entry: CacheEntry<T>): void {
      entries.set(entry.key, entry as CacheEntry);
    },
    invalidate(resources: readonly ResourceRef[]): InvalidationEvent {
      const set = new Set(resources);
      const keys: string[] = [];
      for (const [key, entry] of entries) {
        if (entry.tier !== 1) continue;
        if (entry.resources.some((r) => set.has(r))) {
          keys.push(key);
          entries.delete(key);
        }
      }
      return { resources: [...resources], keys };
    },
    invalidateFromEffects(writeEffects: Effects): InvalidationEvent {
      return this.invalidate(resourcesTouchedByWrites(writeEffects));
    },
    keys(): string[] {
      return [...entries.keys()];
    },
    clear(): void {
      entries.clear();
    },
  };
}

/**
 * Parse a short TTL string (`"5m"`, `"1h"`, `"30s"`) to milliseconds.
 *
 * @param ttl - Duration string
 */
export function parseTtlMs(ttl: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(ttl.trim());
  if (!match) return 0;
  const n = Number(match[1]);
  const unit = match[2];
  switch (unit) {
    case "ms":
      return n;
    case "s":
      return n * 1000;
    case "m":
      return n * 60_000;
    case "h":
      return n * 3_600_000;
    case "d":
      return n * 86_400_000;
    default:
      return 0;
  }
}
