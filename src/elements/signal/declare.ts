/**
 * Signal declaration — data in motion.
 *
 * `delivery` is mandatory with no default: queue / pub-sub / stream were
 * always one object with different physics (unified-theory §3).
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

/** Shared options for every {@link signal} delivery mode. */
interface SignalOptionsBase {
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

/**
 * Options for {@link signal}.
 *
 * `retention` is live-only — a type error on `once` / `broadcast`.
 */
export type SignalOptions =
  | (SignalOptionsBase & {
      readonly delivery: "once" | "broadcast";
      readonly retention?: never;
    })
  | (SignalOptionsBase & {
      readonly delivery: "live";
      readonly retention?: SignalRetention;
    });

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

/**
 * `signal()` pushes into the shared {@link signalRegistry}
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

/**
 * Declare a signal. `delivery` is mandatory — omitting it is a type error.
 *
 * @param name - Signal name
 * @param options - Delivery physics and retry / DLQ policy
 */
export function signal<T = unknown>(name: string, options: SignalOptions): SignalDecl<T> {
  if (
    options.delivery !== "once" &&
    options.delivery !== "broadcast" &&
    options.delivery !== "live"
  ) {
    throw new TypeError(`signal("${name}"): delivery is mandatory (once | broadcast | live)`);
  }
  const retention = "retention" in options ? options.retention : undefined;
  if (retention !== undefined && options.delivery !== "live") {
    throw new TypeError(`signal("${name}"): retention is only valid with delivery: "live"`);
  }
  if (retention?.maxAge !== undefined && parseDurationMs(retention.maxAge) <= 0) {
    throw new TypeError(
      `signal("${name}"): retention.maxAge must be a duration like "24h" or "30s"`,
    );
  }
  if (
    retention?.maxCount !== undefined &&
    (!Number.isInteger(retention.maxCount) || retention.maxCount < 1)
  ) {
    throw new TypeError(`signal("${name}"): retention.maxCount must be an integer ≥ 1`);
  }
  const decl: SignalDecl<T> = {
    name,
    delivery: options.delivery,
    ...(options.description !== undefined ? { description: options.description } : {}),
    retries: options.retries ?? 3,
    deadLetter: options.deadLetter ?? true,
    schema: options.schema,
    optional: options.optional ?? false,
    ...(options.delivery === "live" && retention !== undefined ? { retention } : {}),
  };
  signalRegistry.push(decl as SignalDecl);
  return decl;
}
