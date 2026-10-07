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

/** Options for {@link createStoreCache}. */
export interface CreateStoreCacheOptions {
  /** Clock for TTL expiry. */
  readonly now?: () => number;
  /** Entry cap. Default 10_000. Oldest entry is dropped. */
  readonly maxEntries?: number;
  /** TTL applied when a put does not set one. Default 60_000. */
  readonly defaultTtlMs?: number;
  /**
   * Tell other instances which resources changed. Not called for
   * {@link StoreCache.acceptRemote}.
   */
  readonly fanout?: (resources: readonly ResourceRef[]) => void;
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
  /** Default TTL for puts that omit one. */
  readonly defaultTtlMs: number;
  /** Current generation for a resource. Invalidation increments it. */
  generationOf(resource: string): number;
  /** True when every resource is still at the captured generation. */
  sameGeneration(snapshot: Readonly<Record<string, number>>): boolean;
  /**
   * Apply an invalidation that arrived from another instance.
   * Does not call `fanout`.
   *
   * @param resources - Resources the other instance wrote
   */
  acceptRemote(resources: readonly ResourceRef[]): InvalidationEvent;
  /**
   * Run `task` once per key. A caller that joined before an invalidation
   * refetches once instead of keeping a value the cache will not store.
   *
   * @param key - Flight key
   * @param resources - Resources read by the flight
   * @param task - Loader
   */
  coalesce<T>(
    key: string,
    resources: readonly string[],
    task: () => Promise<T>,
  ): Promise<{ readonly value: T; readonly cacheable: boolean }>;
}

/**
 * Create an in-memory store cache (all three tiers share one map; tier is metadata).
 *
 * @param now - Clock for TTL expiry
 */
export function createStoreCache(
  nowOrOptions: (() => number) | CreateStoreCacheOptions = {},
): StoreCache {
  const options: CreateStoreCacheOptions =
    typeof nowOrOptions === "function" ? { now: nowOrOptions } : nowOrOptions;
  const now = options.now ?? (() => Date.now());
  const maxEntries = options.maxEntries ?? 10_000;
  const defaultTtlMs = options.defaultTtlMs ?? 60_000;
  const entries = new Map<string, CacheEntry>();
  const byResource = new Map<string, Set<string>>();
  const generations = new Map<string, number>();
  const flights = new Map<
    string,
    {
      readonly promise: Promise<unknown>;
      readonly resources: readonly string[];
      readonly generation: Readonly<Record<string, number>>;
    }
  >();

  function alive(entry: CacheEntry): boolean {
    return entry.expiresAt === null || entry.expiresAt > now();
  }

  function forget(key: string): void {
    const entry = entries.get(key);
    entries.delete(key);
    if (!entry) return;
    for (const resource of entry.resources) byResource.get(resource)?.delete(key);
  }

  function snapshot(resources: readonly string[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const resource of resources) out[resource] = generations.get(resource) ?? 0;
    return out;
  }

  function dropFlights(resources: readonly ResourceRef[]): void {
    const set = new Set(resources);
    for (const [key, flight] of flights) {
      if (flight.resources.some((resource) => set.has(resource as ResourceRef))) {
        flights.delete(key);
      }
    }
  }

  function invalidateLocal(resources: readonly ResourceRef[]): InvalidationEvent {
    const keys: string[] = [];
    for (const resource of resources) {
      generations.set(resource, (generations.get(resource) ?? 0) + 1);
      const held = byResource.get(resource);
      if (!held) continue;
      for (const key of held) {
        keys.push(key);
        forget(key);
      }
      held.clear();
    }
    dropFlights(resources);
    return { resources: [...resources], keys };
  }

  const api: StoreCache = {
    defaultTtlMs,
    get<T = unknown>(key: string): T | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (!alive(entry)) {
        forget(key);
        return undefined;
      }
      entries.delete(key);
      entries.set(key, entry);
      return entry.value as T;
    },
    set<T>(entry: CacheEntry<T>): void {
      forget(entry.key);
      entries.set(entry.key, entry as CacheEntry);
      for (const resource of entry.resources) {
        const set = byResource.get(resource) ?? new Set<string>();
        set.add(entry.key);
        byResource.set(resource, set);
      }
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        forget(oldest);
      }
    },
    invalidate(resources: readonly ResourceRef[]): InvalidationEvent {
      const event = invalidateLocal(resources);
      options.fanout?.(resources);
      return event;
    },
    generationOf(resource: string): number {
      return generations.get(resource) ?? 0;
    },
    sameGeneration(shot: Readonly<Record<string, number>>): boolean {
      for (const [resource, generation] of Object.entries(shot)) {
        if ((generations.get(resource) ?? 0) !== generation) return false;
      }
      return true;
    },
    acceptRemote(resources: readonly ResourceRef[]): InvalidationEvent {
      return invalidateLocal(resources);
    },
    async coalesce<T>(
      key: string,
      resources: readonly string[],
      task: () => Promise<T>,
    ): Promise<{ readonly value: T; readonly cacheable: boolean }> {
      const existing = flights.get(key);
      if (existing) {
        const value = (await existing.promise) as T;
        if (api.sameGeneration(existing.generation)) return { value, cacheable: true };
        const again = await task();
        return { value: again, cacheable: api.sameGeneration(snapshot(resources)) };
      }
      const generation = snapshot(resources);
      const promise = task();
      flights.set(key, { promise, resources, generation });
      try {
        const value = await promise;
        return { value, cacheable: api.sameGeneration(generation) };
      } finally {
        if (flights.get(key)?.promise === promise) flights.delete(key);
      }
    },
    invalidateFromEffects(writeEffects: Effects): InvalidationEvent {
      return this.invalidate(resourcesTouchedByWrites(writeEffects));
    },
    keys(): string[] {
      return [...entries.keys()];
    },
    clear(): void {
      entries.clear();
      byResource.clear();
    },
  };
  return api;
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

/** Effect list keys that disqualify tier-1 auto-cache when non-empty. */
const DISQUALIFYING_EFFECTS = [
  "writes",
  "emits",
  "sends",
  "asks",
  "embeds",
  "secrets",
  "calls",
  "fetches",
  "decides",
] as const satisfies readonly (keyof Effects)[];

/**
 * Store and non-store effects recorded on one invocation's ledger.
 *
 * Side effects stay on the result so auto-cache can refuse a flow that
 * also fetched, emitted, or called — a learned store read is not enough.
 *
 * @param entries - Ledger entries from the invocation
 */
export function effectsFromLedger(
  entries: readonly { readonly kind: string; readonly resource: string }[],
): Effects {
  const reads: string[] = [];
  const writes: string[] = [];
  const asks: string[] = [];
  const emits: string[] = [];
  const sends: string[] = [];
  const embeds: string[] = [];
  const secrets: string[] = [];
  const calls: string[] = [];
  const fetches: string[] = [];
  const decides: string[] = [];
  const seen = new Set<string>();
  const push = (bucket: string[], kind: string, resource: string): void => {
    const key = `${kind}:${resource}`;
    if (seen.has(key)) return;
    seen.add(key);
    bucket.push(resource);
  };
  for (const entry of entries) {
    switch (entry.kind) {
      case "read":
        push(reads, entry.kind, entry.resource);
        break;
      case "write":
        push(writes, entry.kind, entry.resource);
        break;
      case "ask":
        push(asks, entry.kind, entry.resource);
        break;
      case "emit":
        push(emits, entry.kind, entry.resource);
        break;
      case "send":
        push(sends, entry.kind, entry.resource);
        break;
      case "embed":
        push(embeds, entry.kind, entry.resource);
        break;
      case "secret":
        push(secrets, entry.kind, entry.resource);
        break;
      case "call":
        push(calls, entry.kind, entry.resource);
        break;
      case "fetch":
        push(fetches, entry.kind, entry.resource);
        break;
      case "decide":
        push(decides, entry.kind, entry.resource);
        break;
      default:
        break;
    }
  }
  return {
    ...(reads.length > 0 ? { reads: reads as Effects["reads"] } : {}),
    ...(writes.length > 0 ? { writes: writes as Effects["writes"] } : {}),
    ...(asks.length > 0 ? { asks } : {}),
    ...(emits.length > 0 ? { emits } : {}),
    ...(sends.length > 0 ? { sends } : {}),
    ...(embeds.length > 0 ? { embeds } : {}),
    ...(secrets.length > 0 ? { secrets } : {}),
    ...(calls.length > 0 ? { calls } : {}),
    ...(fetches.length > 0 ? { fetches } : {}),
    ...(decides.length > 0 ? { decides } : {}),
  };
}

/**
 * True when every effect is a store read (`sql:` / `kv:` / `files:` / `index:`).
 *
 * Sends, emits, fetches, vault reads, asks, decides, calls, writes, and
 * non-store reads (`runs`, `signal:`) are not cacheable.
 *
 * @param effects - Declared or ledgered effects
 */
export function autoCachePure(effects: Effects | undefined): boolean {
  if (!effects) return false;
  for (const key of DISQUALIFYING_EFFECTS) {
    if ((effects[key]?.length ?? 0) > 0) return false;
  }
  const reads = effects.reads ?? [];
  if (reads.length === 0) return false;
  return reads.every((ref) => isStoreResourceRef(ref));
}

/**
 * Union two effect bags. Used so a ledgered fetch cannot be dropped
 * before the auto-cache eligibility check.
 *
 * @param left - Declared or previously resolved effects
 * @param right - Ledgered effects
 */
export function mergeEffects(left: Effects, right: Effects): Effects {
  const reads = union(left.reads, right.reads);
  const writes = union(left.writes, right.writes);
  const emits = union(left.emits, right.emits);
  const sends = union(left.sends, right.sends);
  const asks = union(left.asks, right.asks);
  const embeds = union(left.embeds, right.embeds);
  const secrets = union(left.secrets, right.secrets);
  const calls = union(left.calls, right.calls);
  const fetches = union(left.fetches, right.fetches);
  const decides = union(left.decides, right.decides);
  return {
    ...(reads.length > 0 ? { reads } : {}),
    ...(writes.length > 0 ? { writes } : {}),
    ...(emits.length > 0 ? { emits } : {}),
    ...(sends.length > 0 ? { sends } : {}),
    ...(asks.length > 0 ? { asks } : {}),
    ...(embeds.length > 0 ? { embeds } : {}),
    ...(secrets.length > 0 ? { secrets } : {}),
    ...(calls.length > 0 ? { calls } : {}),
    ...(fetches.length > 0 ? { fetches } : {}),
    ...(decides.length > 0 ? { decides } : {}),
  };
}

/**
 * Stable union of two effect lists.
 *
 * @param left - First list
 * @param right - Second list
 */
function union<T extends string>(left?: readonly T[], right?: readonly T[]): T[] {
  if ((left?.length ?? 0) === 0 && (right?.length ?? 0) === 0) return [];
  return [...new Set([...(left ?? []), ...(right ?? [])])];
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
  if (declared && !autoCachePure(declared) && hasAnyEffect(declared)) {
    return declared;
  }
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
 * Whether the effect bag records anything.
 *
 * @param effects - Declared or ledgered effects
 */
function hasAnyEffect(effects: Effects): boolean {
  const keys = ["reads", ...DISQUALIFYING_EFFECTS] as const;
  return keys.some((key) => (effects[key]?.length ?? 0) > 0);
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
 * Caller dimensions stamped into a tier-1 cache key.
 *
 * Segments are always present so an empty tenant cannot collide with a set one.
 */
export interface Tier1Caller {
  /** Authenticated user id. Empty when anonymous. */
  readonly userId?: string | null;
  /** Active tenant id. Empty when tenancy is off. */
  readonly tenantId?: string | null;
  /** Resolved request locale. */
  readonly locale?: string | null;
  /** Effective scopes, including the tenant-role union. */
  readonly scopes?: Iterable<string>;
  /**
   * Membership role names. Cache identity only — gates do not read this.
   */
  readonly roles?: Iterable<string>;
  /** Email / session verified bit. `v:0` and `v:1` must not share an entry. */
  readonly verified?: boolean;
  /** Operator id when the caller is on the operator plane. */
  readonly operatorId?: string | null;
}

/**
 * Whether a flow should use automatic tier-1 cache.
 *
 * On by default for a pure store read that is not durable. `auto: false`
 * turns the app default off; a flow can still opt in with `cache: true` or a
 * duration. `cache: false` always disables. Sends, emits, fetches, secrets,
 * calls, asks, embeds, decides, and writes are never cached.
 *
 * @param options - Flow cache flag, app switch, durability, and effect set
 */
export function autoCacheEligible(options: {
  readonly cache?: boolean | string;
  /** App-level switch. Omitted means on. `false` turns auto-cache off. */
  readonly auto?: boolean;
  readonly durable?: boolean;
  readonly effects?: Effects;
}): boolean {
  if (options.cache === false) return false;
  if (options.durable === true) return false;
  if (options.auto === false && options.cache !== true && typeof options.cache !== "string") {
    return false;
  }
  return autoCachePure(options.effects);
}

/**
 * Dimension suffixes for a flow-scoped tier-1 key.
 *
 * Format after {@link computedCacheKey}:
 * `computed:{resource}/{flow}/{input}/{userId}/t:{tenant}/l:{locale}/s:{scopes}/r:{roles}`.
 * Invalidation still keys off the resource segment.
 *
 * A string third argument is the user id (older call shape).
 *
 * @param flowName - Flow id
 * @param input - Validated flow input
 * @param caller - Caller identity, or a user id string
 */
export function tier1FlowDims(
  flowName: string,
  input: unknown,
  caller?: Tier1Caller | string | null,
): readonly string[] {
  const identity: Tier1Caller =
    typeof caller === "string" || caller == null ? { userId: caller ?? null } : caller;
  const scopes = [...(identity.scopes ?? [])].sort();
  const roles = [...(identity.roles ?? [])].sort();
  return [
    flowName,
    fingerprintInput(input),
    identity.userId ?? "",
    `t:${identity.tenantId ?? ""}`,
    `l:${identity.locale ?? ""}`,
    `s:${scopes.join(",")}`,
    `r:${roles.join(",")}`,
    `v:${identity.verified === true ? "1" : "0"}`,
    `o:${identity.operatorId ?? ""}`,
  ];
}

/**
 * Per-resource dim map for {@link tier1KeysForReads} / `putTier1`.
 *
 * @param effects - Read effects
 * @param flowName - Flow id
 * @param input - Validated flow input
 * @param caller - Caller identity, or a user id string
 */
export function tier1DimsByResource(
  effects: Effects,
  flowName: string,
  input: unknown,
  caller?: Tier1Caller | string | null,
): Readonly<Record<string, readonly string[]>> {
  const dims = tier1FlowDims(flowName, input, caller);
  const out: Record<string, readonly string[]> = {};
  for (const resource of effects.reads ?? []) {
    if (!isStoreResourceRef(resource)) continue;
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
