/**
 * Signal element — data in motion.
 *
 * Delivery physics via helpers: `signal.once` · `signal.broadcast` · `signal.live`.
 * Drivers: `memory` · `postgres` (default / transactional) · `redis` · `nats`.
 * @module
 */

export { signal } from "./signal/declare.ts";
export type {
  SignalDecl,
  SignalLiveOptions,
  SignalNamespace,
  SignalOptions,
  SignalRetention,
  SignalSharedOptions,
} from "./signal/declare.ts";
export type { DeadLetter, SignalFailureReason } from "../drivers/signal-types.ts";

export { createSignalRuntime } from "./signal/runtime.ts";
export type { CreateSignalRuntimeOptions, SignalRuntime } from "./signal/runtime.ts";

export { reconcileSignals, createMemorySignalConfigStore } from "./signal/reconcile.ts";
export type {
  SignalConfigRow,
  SignalConfigStatus,
  SignalConfigStore,
  SignalReconcileResult,
} from "./signal/reconcile.ts";
