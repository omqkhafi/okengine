/**
 * Signal declaration — data in motion.
 *
 * `delivery` is mandatory with no default: queue / pub-sub / stream were
 * always one object with different physics (unified-theory §3).
 */

import type { SignalDelivery } from "../../manifest/types.ts";
import { signalRegistry } from "../../kernel/element-registries.ts";

/** Options for {@link signal}. */
export interface SignalOptions {
  /**
   * Delivery physics — required, no default.
   *
   * - `once` — competing consumers, retries, DLQ
   * - `broadcast` — every subscriber receives a copy
   * - `live` — client-subscribable stream (replayable)
   */
  readonly delivery: SignalDelivery;
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
  const decl: SignalDecl<T> = {
    name,
    delivery: options.delivery,
    ...(options.description !== undefined ? { description: options.description } : {}),
    retries: options.retries ?? 3,
    deadLetter: options.deadLetter ?? true,
    schema: options.schema,
    optional: options.optional ?? false,
  };
  signalRegistry.push(decl as SignalDecl);
  return decl;
}
