/**
 * Gate element — permission to act.
 *
 * Physics: auth · session · ABAC · rate limit · quota · feature flag.
 * Rate strategies are atomic Lua on the kv driver.
 *
 * Drivers: inherits `store.kv` (`memory` · `redis`).
 * @module
 */

export {
  gate,
  GATE_PUBLIC_NAME,
  flattenGateArgs,
  flattenGateMembers,
  isGateAllDecl,
} from "./gate/declare.ts";
export type {
  GateAllDecl,
  GateDecl,
  GateMember,
  GatePolicyContext,
  PolicyGateDecl,
  PolicyGateOptions,
  RateGateDecl,
  RateOptions,
} from "./gate/declare.ts";

export {
  resolveGateConfig,
  type GateOptions,
  type GateRateLimitOptions,
  type ResolvedGateConfig,
  type ResolveGateConfigOptions,
} from "./gate/config.ts";

export {
  GateBootError,
  assertHttpGatePosture,
  collectUnguardedHttpGaps,
  hasHttpGatePosture,
  isPublicGateRef,
  unguardedHttpAllowActive,
  type AssertHttpGatePostureOptions,
  type GatePostureGap,
} from "./gate/boot.ts";

export {
  createGateRuntime,
  type CreateGateRuntimeOptions,
  type GateEvaluation,
  type GateKv,
  type GateRuntime,
} from "./gate/runtime.ts";

export { ALL_RATE_STRATEGIES, DEFAULT_RATE_STRATEGY } from "./gate/constants.ts";

export {
  takeRate,
  luaForStrategy,
  RATE_STRATEGIES,
  type RateTakeResult,
  type TakeRateOptions,
} from "./gate/strategies.ts";

export { deriveModuleActions, flowIdToAction, formatGatesList } from "./gate/permissions.ts";
