/**
 * Gate element — permission to act.
 *
 * Physics: auth · session · ABAC · rate limit · quota · feature flag.
 * Rate strategies are atomic Lua on the kv driver.
 *
 * Drivers: inherits `store.kv` (`memory` · `redis`).
 * @module
 */

export { gate } from "./gate/declare.ts";
export type {
  GateDecl,
  GatePolicyContext,
  PolicyGateDecl,
  RateGateDecl,
  RateOptions,
} from "./gate/declare.ts";

export {
  createGateRuntime,
  type CreateGateRuntimeOptions,
  type GateEvaluation,
  type GateKv,
  type GateRuntime,
} from "./gate/runtime.ts";

export {
  takeRate,
  luaForStrategy,
  ALL_RATE_STRATEGIES,
  DEFAULT_RATE_STRATEGY,
  RATE_STRATEGIES,
  type RateTakeResult,
  type TakeRateOptions,
} from "./gate/strategies.ts";

export { deriveModuleActions, flowIdToAction, formatGatesList } from "./gate/permissions.ts";
