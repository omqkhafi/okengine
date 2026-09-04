/**
 * Signal declaration — data in motion.
 *
 * Delivery physics are chosen by helper name (`signal.once` / `broadcast` /
 * `live`), matching `http.get` / `http.post` — no default, no options bag for mode.
 */

import type { SignalDelivery } from "../../manifest/types.ts";
import { signalRegistry } from "../../kernel/element-registries.ts";
import { parseDurationMs } from "../clock/duration.ts";

/** Live-tape cap. Omit both fields (or omit `retention`) for an unbounded tape. */
export interface SignalRetention {
  /** Drop events older than this duration (`"7d"`, `"1h"`, `"30s"`, …). */
  readonly maxAge?: string;
  /** Keep only the newest N live events. */
  readonly maxCount?: number;
}

/** Shared options for every {@link signal} delivery helper. */
export interface SignalSharedOptions {
  /** Optional human description for Console / docs (falls back to the signal name). */
  readonly description?: string;
  /** Max delivery attempts before dead-letter (once). */
  readonly retries?: number;
  /** Preserve exhausted messages in the DLQ (once). */
  readonly deadLetter?: boolean;
  /**
   * Optional payload schema (Standard Schema).
   * Enforced at `emit` via the same `validate()` path as Flow `in`.
   */
  readonly schema?: unknown;
  /** Allow emit with zero subscribers (skip orphan check). */
  readonly optional?: boolean;
}

/** Options for {@link signal.live} — shared fields plus optional tape retention. */
export type SignalLiveOptions = SignalSharedOptions & {
  readonly retention?: SignalRetention;
};

/**
 * @deprecated Prefer {@link SignalSharedOptions} / {@link SignalLiveOptions}.
 * Alias kept for type-only imports that still name `SignalOptions`.
 */
export type SignalOptions = SignalSharedOptions | SignalLiveOptions;

/**
 * Declared signal handle — usable as `on(signal, flow)`, `fx.emit(signal, …)`,
 * and `fx.deadLetters(signal)`.
 */
export interface SignalDecl<T = unknown> {
  /** Signal name (manifest key). */
  readonly name: string;
  /** Delivery physics. */
  readonly delivery: SignalDelivery;
  /** Optional human description. */
  readonly description?: string;
  /** Max retries before DLQ. */
  readonly retries: number;
  /** Whether exhausted messages enter the DLQ. */
  readonly deadLetter: boolean;
  /** Optional schema. */
  readonly schema?: unknown;
  /** Optional orphan-emit allowance. */
  readonly optional: boolean;
  /** Live-tape cap (`delivery: "live"` only). Omitted = unbounded. */
  readonly retention?: SignalRetention;
  /** Phantom payload type for typed emits. */
  readonly _payload?: T;
}

/** Public Signal declaration namespace — `signal.once` / `broadcast` / `live`. */
export interface SignalNamespace {
  /**
   * Competing queue — exactly one subscriber claims each message.
   *
   * @param name - Signal name
   * @param options - Retry / DLQ / schema policy
   */
  once<T = unknown>(name: string, options?: SignalSharedOptions): SignalDecl<T>;
  /**
   * Pub/sub fan-out — every subscriber receives each message.
   *
   * @param name - Signal name
   * @param options - Schema / optional policy
   */
  broadcast<T = unknown>(name: string, options?: SignalSharedOptions): SignalDecl<T>;
  /**
   * Live SSE tape — retained stream for `http.live` / `.live(signal)`.
   *
   * @param name - Signal name
   * @param options - Retention / schema / optional policy
   */
  live<T = unknown>(name: string, options?: SignalLiveOptions): SignalDecl<T>;
}

/**
 * `signal.*` pushes into the shared {@link signalRegistry}
 * (`src/kernel/element-registries.ts`) so {@link oke} can auto-populate
 * `signals` with zero explicit array — mirrors the {@link on} trigger-drain
 * registry (`src/kernel/on.ts`).
 *
 * Snapshot of every signal declared since the last reset.
 */
export function listSignals(): readonly SignalDecl[] {
  return signalRegistry.slice();
}

/**
 * Clear the signal registry (tests / fresh app adopt).
 *
 * @internal
 */
export function resetSignals(): void {
  signalRegistry.length = 0;
}

function declareSignal<T = unknown>(
  name: string,
  delivery: SignalDelivery,
  options: SignalSharedOptions | SignalLiveOptions = {},
): SignalDecl<T> {
  const retention = "retention" in options ? options.retention : undefined;
  if (retention !== undefined && delivery !== "live") {
    throw new TypeError(`signal.${delivery}("${name}"): retention is only valid with signal.live`);
  }
  if (retention?.maxAge !== undefined && parseDurationMs(retention.maxAge) <= 0) {
    throw new TypeError(
      `signal.live("${name}"): retention.maxAge must be a duration like "24h" or "30s"`,
    );
  }
  if (
    retention?.maxCount !== undefined &&
    (!Number.isInteger(retention.maxCount) || retention.maxCount < 1)
  ) {
    throw new TypeError(`signal.live("${name}"): retention.maxCount must be an integer ≥ 1`);
  }
  const decl: SignalDecl<T> = {
    name,
    delivery,
    ...(options.description !== undefined ? { description: options.description } : {}),
    retries: options.retries ?? 3,
    deadLetter: options.deadLetter ?? true,
    schema: options.schema,
    optional: options.optional ?? false,
    ...(delivery === "live" && retention !== undefined ? { retention } : {}),
  };
  signalRegistry.push(decl as SignalDecl);
  return decl;
}

/**
 * Declare a signal. Delivery physics are chosen by helper name —
 * `signal.once` · `signal.broadcast` · `signal.live`.
 */
export const signal: SignalNamespace = {
  once<T = unknown>(name: string, options?: SignalSharedOptions): SignalDecl<T> {
    return declareSignal(name, "once", options);
  },
  broadcast<T = unknown>(name: string, options?: SignalSharedOptions): SignalDecl<T> {
    return declareSignal(name, "broadcast", options);
  },
  live<T = unknown>(name: string, options?: SignalLiveOptions): SignalDecl<T> {
    return declareSignal(name, "live", options);
  },
};
