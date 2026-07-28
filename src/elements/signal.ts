/**
 * Signal element — data in motion.
 *
 * Delivery physics: `once` · `broadcast` · `live` (mandatory, no default).
 * Drivers: `memory` · `postgres` (default / transactional) · `redis` · `nats`.
 * @module
 */

export { signal } from "./signal/declare.ts";
export type { SignalDecl, SignalOptions } from "./signal/declare.ts";

export { createSignalRuntime } from "./signal/runtime.ts";
export type { CreateSignalRuntimeOptions, SignalRuntime } from "./signal/runtime.ts";

export { reconcileSignals, createMemorySignalConfigStore } from "./signal/reconcile.ts";
export type {
  SignalConfigRow,
  SignalConfigStatus,
  SignalConfigStore,
  SignalReconcileResult,
} from "./signal/reconcile.ts";
