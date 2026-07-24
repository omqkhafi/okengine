/**
 * Effect recording and the typed effect ledger.
 *
 * Every `fx` world access appends an {@link EffectEntry}. The ledger is what
 * the journal, tests, runs store, and capability check all read.
 */

/** The seven load-bearing effect kinds (manifest `effects` keys, singular). */
export type EffectKind =
  | "read"
  | "write"
  | "emit"
  | "send"
  | "ask"
  | "secret"
  | "call";

/**
 * Reversibility tier — console §9.1 ranking, applied to all seven kinds.
 *
 * - `none` — reads; no world change
 * - `reversible` — writes; undoable in-transaction
 * - `deferred` — emits; commit with the txn, then fan-out
 * - `irreversible` — sends / asks; cannot be undone by the runtime
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

/** One recorded effect call. */
export interface EffectEntry {
  /** Which of the seven kinds. */
  readonly kind: EffectKind;
  /** Resource / signal / template / prompt / secret / flow ref. */
  readonly resource: string;
  /** Epoch-ms when the call started. */
  readonly timestamp: number;
  /** Wall duration in milliseconds. */
  readonly duration: number;
  /** Reversibility tier for {@link kind}. */
  readonly reversibility: ReversibilityTier;
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
  secret: "capability",
  call: "portal",
};

/**
 * Reversibility tier for an effect kind.
 *
 * @param kind - One of the seven effect kinds
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
 * @param ledger - Target ledger
 * @param kind - Effect kind
 * @param resource - Resource ref
 * @param now - Clock (injectable for tests)
 * @param body - Work to time
 */
export async function recordEffect<T>(
  ledger: EffectLedger,
  kind: EffectKind,
  resource: string,
  now: () => number,
  body: () => T | Promise<T>,
): Promise<T> {
  const timestamp = now();
  try {
    return await body();
  } finally {
    ledger.record({
      kind,
      resource,
      timestamp,
      duration: Math.max(0, now() - timestamp),
      reversibility: reversibilityOf(kind),
    });
  }
}

/**
 * All seven kinds with their tiers — useful for exhaustive tests.
 */
export const EFFECT_KIND_TIERS: ReadonlyArray<{
  kind: EffectKind;
  reversibility: ReversibilityTier;
}> = (
  Object.entries(TIER_BY_KIND) as Array<[EffectKind, ReversibilityTier]>
).map(([kind, reversibility]) => ({ kind, reversibility }));
