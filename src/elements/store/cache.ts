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
  const reads = (effects.reads ?? []).filter((r): r is ResourceRef => isStoreResourceRef(r));
  return reads.map((resource) => computedCacheKey(resource, dimsByResource?.[resource]));
}

/**
 * Resources whose tier-1 entries a write must invalidate.
 *
 * @param effects - Write flow effects
 */
export function resourcesTouchedByWrites(effects: Effects): ResourceRef[] {
  return (effects.writes ?? []).filter((r): r is ResourceRef => isStoreResourceRef(r));
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

/** Store resource refs that participate in the automatic cache cycle. */
const STORE_REF = /^(sql|kv|files|index):/;

/**
 * Whether `ref` is a store resource the tier-1 cycle can key off.
 *
 * @param ref - Effect resource
 */
export function isStoreResourceRef(ref: string): ref is ResourceRef {
  return STORE_REF.test(ref) && ref !== "runs";
}

/**
 * Store reads / writes / asks recorded on one invocation's ledger.
 *
 * Used when the flow has no stamped `effects` (open capability token) so
 * the cache cycle still runs from what `fx.store` actually touched.
 *
 * @param entries - Ledger entries from the invocation
 */
export function effectsFromLedger(
  entries: readonly { readonly kind: string; readonly resource: string }[],
): Effects {
  const reads: ResourceRef[] = [];
  const writes: ResourceRef[] = [];
  const asks: string[] = [];
  const seenRead = new Set<string>();
  const seenWrite = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === "ask") {
      asks.push(entry.resource);
      continue;
    }
    if (!isStoreResourceRef(entry.resource)) continue;
    if (entry.kind === "read" && !seenRead.has(entry.resource)) {
      seenRead.add(entry.resource);
      reads.push(entry.resource);
    }
    if (entry.kind === "write" && !seenWrite.has(entry.resource)) {
      seenWrite.add(entry.resource);
      writes.push(entry.resource);
    }
  }
  return {
    ...(reads.length > 0 ? { reads } : {}),
    ...(writes.length > 0 ? { writes } : {}),
    ...(asks.length > 0 ? { asks } : {}),
  };
}

/**
 * Effects the auto-cache lookup should use: stamped reads when present,
 * otherwise reads learned from a previous run's ledger.
 *
 * @param declared - Flow or capability effects (empty when the token is open)
 * @param learnedReads - Store reads observed on an earlier invocation
 */
export function resolveCacheEffects(
  declared: Effects | undefined,
  learnedReads: readonly ResourceRef[] | undefined,
): Effects {
  const declaredReads = (declared?.reads ?? []).filter((r) => isStoreResourceRef(r));
  if (declaredReads.length > 0 || (declared?.writes?.length ?? 0) > 0) {
    return declared ?? {};
  }
  if (learnedReads !== undefined && learnedReads.length > 0) {
    return { reads: [...learnedReads] };
  }
  return declared ?? {};
}

/**
 * Tier-1 hit only when every key is still present (a write to any
 * contributing resource must miss).
 *
 * @param get - Cache getter
 * @param keys - Keys from {@link tier1KeysForReads}
 */
export function tier1Lookup<T>(
  get: (key: string) => T | undefined,
  keys: readonly string[],
): T | undefined {
  const first = keys[0];
  if (first === undefined) return undefined;
  const value = get(first);
  if (value === undefined) return undefined;
  for (let i = 1; i < keys.length; i++) {
    const key = keys[i];
    if (key === undefined || get(key) === undefined) return undefined;
  }
  return value;
}

/**
 * Whether a flow should use automatic tier-1 cache.
 *
 * Read-only flows (inferred, declared, or ledgered `reads`, no `writes`)
 * cache by default. Opt out with `cache: false`. Mutations, AI asks,
 * durable flows, and empty effect sets stay uncached — no `cache: "30s"`
 * or hand-declared `effects` required on the flow.
 *
 * @param options - Flow cache flag, durability, and effect set
 */
export function autoCacheEligible(options: {
  readonly cache?: boolean | string;
  readonly durable?: boolean;
  readonly effects?: Effects;
}): boolean {
  if (options.cache === false) return false;
  if (options.durable === true) return false;
  const effects = options.effects ?? {};
  if ((effects.asks?.length ?? 0) > 0) return false;
  if ((effects.writes?.length ?? 0) > 0) return false;
  const reads = (effects.reads ?? []).filter((r) => isStoreResourceRef(r));
  return reads.length > 0;
}

/**
 * Dimension suffixes for a flow-scoped tier-1 key.
 *
 * Format after {@link computedCacheKey}: `computed:{resource}/{flow}/{input}[/{userId}]`.
 * Invalidation still keys off the resource segment.
 *
 * @param flowName - Flow id
 * @param input - Validated flow input
 * @param userId - Caller id when present (per-user lists)
 */
export function tier1FlowDims(
  flowName: string,
  input: unknown,
  userId?: string | null,
): readonly string[] {
  const dims = [flowName, fingerprintInput(input)];
  if (userId) dims.push(userId);
  return dims;
}

/**
 * Per-resource dim map for {@link tier1KeysForReads} / `putTier1`.
 *
 * @param effects - Read effects
 * @param flowName - Flow id
 * @param input - Validated flow input
 * @param userId - Caller id when present
 */
export function tier1DimsByResource(
  effects: Effects,
  flowName: string,
  input: unknown,
  userId?: string | null,
): Readonly<Record<string, readonly string[]>> {
  const dims = tier1FlowDims(flowName, input, userId);
  const out: Record<string, readonly string[]> = {};
  for (const resource of effects.reads ?? []) {
    if (resource === "runs") continue;
    out[resource] = dims;
  }
  return out;
}

/**
 * Stable-enough input fingerprint for a cache dim.
 *
 * @param input - Validated flow input
 */
function fingerprintInput(input: unknown): string {
  if (input === undefined || input === null) return "-";
  const t = typeof input;
  if (t === "string" || t === "number" || t === "boolean") return String(input);
  try {
    return JSON.stringify(input);
  } catch {
    return "-";
  }
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
