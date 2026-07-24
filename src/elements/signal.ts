/**
 * Signal element — data in motion.
 *
 * Delivery physics: `once` · `broadcast` · `live` (mandatory, no default).
 * Drivers: `memory` · `postgres` (default / transactional) · `redis` · `nats`.
 */

export { signal } from "./signal/declare.ts";
export type { SignalDecl, SignalOptions } from "./signal/declare.ts";

export { createSignalRuntime } from "./signal/runtime.ts";
export type {
  CreateSignalRuntimeOptions,
  SignalRuntime,
} from "./signal/runtime.ts";
