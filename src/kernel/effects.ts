/**
 * Effect recording and the typed effect ledger.
 *
 * Every `fx` world access appends an {@link EffectEntry}. The ledger is what
 * the journal, tests, runs store, and capability check all read.
 */

import { resolveDurationMs } from "./elapsed.ts";

/** Load-bearing effect kinds (manifest `effects` keys, singular). */
export type EffectKind =
  | "read"
  | "write"
  | "emit"
  | "send"
  | "ask"
  | "embed"
  | "secret"
  | "call"
  | "fetch";

/**
 * Reversibility tier — console §9.1 ranking, applied to all effect kinds.
 *
 * - `none` — reads; no world change
 * - `reversible` — writes; undoable in-transaction
 * - `deferred` — emits; commit with the txn, then fan-out
 * - `irreversible` — sends / asks / embeds / fetches; cannot be undone by the runtime
 * - `capability` — secrets; authority held, not an effect caused
 * - `portal` — calls; expands to the callee's transitive effects
 */
export type ReversibilityTier =
  | "none"
  | "reversible"
  | "deferred"
  | "irreversible"
  | "capability"
  | "portal";

/**
 * Optional egress identity for an effect that left the process.
 *
 * Driver-reported — never inferred from hostname patterns. Only `host` is
 * required when present; `provider` and `kind` are additive precision.
 *
 * Re-exported from drivers so kernel and driver contracts share one shape.
 */
export type { DriverExternal as EffectExternal } from "../drivers/external.ts";
import type { DriverExternal as EffectExternal } from "../drivers/external.ts";

/** One recorded effect call. */
export interface EffectEntry {
  /** Which effect kind. */
  readonly kind: EffectKind;
  /** Resource / signal / template / prompt / embed-model / secret / flow / host ref. */
  readonly resource: string;
  /** Epoch-ms when the call started. */
  readonly timestamp: number;
  /** Duration in milliseconds (high-res; may be fractional). */
  readonly duration: number;
  /** Reversibility tier for {@link kind}. */
  readonly reversibility: ReversibilityTier;
  /**
   * When set, this effect left the process and reached an external peer.
   * Omitted for in-process work (PGlite, mock AI, local channel console).
   */
  readonly external?: EffectExternal;
}

/** Append-only ledger of effect entries for one flow invocation. */
export interface EffectLedger {
  /** Snapshot of recorded entries in call order. */
  readonly entries: readonly EffectEntry[];
  /**
   * Append a completed effect entry.
   *
   * @param entry - Entry to record
   */
  record(entry: EffectEntry): void;
  /** Clear all entries (test helper). */
  clear(): void;
}

/** Fixed mapping: kind → reversibility tier. */
const TIER_BY_KIND: Readonly<Record<EffectKind, ReversibilityTier>> = {
  read: "none",
  write: "reversible",
  emit: "deferred",
  send: "irreversible",
  ask: "irreversible",
  embed: "irreversible",
  secret: "capability",
  call: "portal",
  fetch: "irreversible",
};

/**
 * Reversibility tier for an effect kind.
 *
 * @param kind - One of the effect kinds
 */
export function reversibilityOf(kind: EffectKind): ReversibilityTier {
  return TIER_BY_KIND[kind];
}

/**
 * Create an empty in-memory effect ledger.
 */
export function createEffectLedger(): EffectLedger {
  const entries: EffectEntry[] = [];
  return {
    get entries() {
      return entries;
    },
    record(entry: EffectEntry): void {
      entries.push(entry);
    },
    clear(): void {
      entries.length = 0;
    },
  };
}

/**
 * Record an effect around an async (or sync) body, measuring duration.
 *
 * Timestamp comes from `now` (epoch-ms). Duration prefers `performance.now()`
 * so a frozen / same-millisecond clock does not record 0.
 *
 * @param ledger - Target ledger
 * @param kind - Effect kind
 * @param resource - Resource ref
 * @param now - Clock (injectable for tests)
 * @param body - Work to time
 * @param externalOf - Optional egress metadata (static or derived from result / error)
 */
export async function recordEffect<T>(
  ledger: EffectLedger,
  kind: EffectKind,
  resource: string,
  now: () => number,
  body: () => T | Promise<T>,
  externalOf?:
    | EffectExternal
    | ((result: T | undefined, error: unknown) => EffectExternal | undefined),
): Promise<T> {
  const timestamp = now();
  const t0 = performance.now();
  let result: T | undefined;
  let error: unknown;
  try {
    result = await body();
    return result;
  } catch (e) {
    error = e;
    throw e;
  } finally {
    const external =
      typeof externalOf === "function" ? externalOf(result, error) : externalOf;
    recordObservedEffect(
      ledger,
      kind,
      resource,
      timestamp,
      resolveDurationMs(now() - timestamp, performance.now() - t0),
      external,
    );
  }
}

/**
 * Append a completed observation that was already timed.
 *
 * Used when the work must not be re-entered (tier-1 cache hit already
 * called `storeRt.cache.get`) but the ledger still needs an honest entry.
 *
 * @param ledger - Target ledger
 * @param kind - Effect kind
 * @param resource - Resource ref (or kernel cache key)
 * @param timestamp - Epoch-ms when the call started
 * @param duration - Measured duration in milliseconds
 * @param external - Optional egress identity
 */
export function recordObservedEffect(
  ledger: EffectLedger,
  kind: EffectKind,
  resource: string,
  timestamp: number,
  duration: number,
  external?: EffectExternal,
): void {
  ledger.record({
    kind,
    resource,
    timestamp,
    duration,
    reversibility: reversibilityOf(kind),
    ...(external !== undefined ? { external } : {}),
  });
}

/**
 * All effect kinds with their tiers — useful for exhaustive tests.
 */
export const EFFECT_KIND_TIERS: ReadonlyArray<{
  kind: EffectKind;
  reversibility: ReversibilityTier;
}> = (Object.entries(TIER_BY_KIND) as Array<[EffectKind, ReversibilityTier]>).map(
  ([kind, reversibility]) => ({ kind, reversibility }),
);
