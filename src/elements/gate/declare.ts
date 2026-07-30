/**
 * Gate declaration — policy · rate.
 *
 * Physics: auth · session · ABAC · rate limit · quota · feature flag.
 */

import type { RateStrategy } from "../../manifest/types.ts";
import { DEFAULT_RATE_STRATEGY } from "./strategies.ts";

/** Context passed to policy predicates at evaluation time. */
export interface GatePolicyContext {
  /** User-plane principal (`fx.auth`). */
  readonly auth: {
    readonly userId: string | null;
    readonly scopes: ReadonlySet<string>;
    readonly verified?: boolean;
  };
  /** Operator-plane principal (`fx.operator`). */
  readonly operator: {
    readonly id: string | null;
  };
  /** Request metadata for `keyBy` (ip, user, …). */
  readonly meta?: {
    readonly ip?: string;
    readonly userId?: string | null;
    readonly [key: string]: unknown;
  };
}

/** Options for {@link gate.rate}. */
export interface RateOptions {
  /**
   * Strategy id. Defaults to `sliding-window-counter`
   * (best accuracy-to-cost ratio — unified-theory §16).
   */
  readonly strategy?: RateStrategy;
  /** Maximum takes within `per`. */
  readonly max: number;
  /** Window / refill period (`"1m"`, `"60s"`, …). */
  readonly per: string;
  /** Subject dimension (`"ip"`, `"user"`, …). */
  readonly keyBy?: string;
  /**
   * When true, the Console may override `max`/`per` in the Store.
   * Without it, no override is possible (console §4.1).
   */
  readonly overridable?: boolean;
  /** Optional human description for Console / docs (falls back to the rate name). */
  readonly description?: string;
}

/** Options object form of {@link gate.policy} (keeps the two-arg check form valid). */
export interface PolicyGateOptions {
  /** Predicate over {@link GatePolicyContext}. */
  readonly check: (ctx: GatePolicyContext) => boolean | Promise<boolean>;
  /** Optional human description for Console / docs (falls back to the policy name). */
  readonly description?: string;
}

/** Policy gate declaration. */
export interface PolicyGateDecl {
  readonly kind: "policy";
  readonly name: string;
  readonly check: (ctx: GatePolicyContext) => boolean | Promise<boolean>;
  readonly description?: string;
}

/** Rate gate declaration. */
export interface RateGateDecl {
  readonly kind: "rate";
  readonly name: string;
  readonly strategy: RateStrategy;
  readonly max: number;
  readonly per: string;
  readonly keyBy?: string;
  readonly overridable: boolean;
  readonly description?: string;
}

/** Declared gate handle. */
export type GateDecl = PolicyGateDecl | RateGateDecl;

/**
 * Shape of the {@link gate} element namespace.
 */
export interface GateNamespace {
  /**
   * Declare a named ABAC / auth policy.
   *
   * @param name - Policy id (also a Module:Action when it contains `:`)
   * @param checkOrOptions - Predicate, or `{ check, description? }`
   */
  policy(
    name: string,
    checkOrOptions: ((ctx: GatePolicyContext) => boolean | Promise<boolean>) | PolicyGateOptions,
  ): PolicyGateDecl;
  /**
   * Declare a rate limit (atomic Lua on the kv driver).
   *
   * @param options - Strategy / max / per / keyBy
   */
  rate(options: RateOptions): RateGateDecl;
}

/**
 * Gate element namespace — `gate.policy` · `gate.rate`.
 */
export const gate: GateNamespace = {
  /**
   * Declare a named ABAC / auth policy.
   *
   * @param name - Policy id (also a Module:Action when it contains `:`)
   * @param checkOrOptions - Predicate, or `{ check, description? }`
   */
  policy(
    name: string,
    checkOrOptions: ((ctx: GatePolicyContext) => boolean | Promise<boolean>) | PolicyGateOptions,
  ): PolicyGateDecl {
    if (typeof checkOrOptions === "function") {
      return { kind: "policy", name, check: checkOrOptions };
    }
    return {
      kind: "policy",
      name,
      check: checkOrOptions.check,
      ...(checkOrOptions.description !== undefined
        ? { description: checkOrOptions.description }
        : {}),
    };
  },

  /**
   * Declare a rate limit (atomic Lua on the kv driver).
   *
   * @param options - Strategy / max / per / keyBy
   */
  rate(options: RateOptions): RateGateDecl {
    if (!(options.max > 0)) {
      throw new TypeError("gate.rate: max must be a positive number");
    }
    if (!options.per) {
      throw new TypeError("gate.rate: per is required");
    }
    const strategy = options.strategy ?? DEFAULT_RATE_STRATEGY;
    const name = `rate:${strategy}:${options.max}/${options.per}`;
    return {
      kind: "rate",
      name,
      strategy,
      max: options.max,
      per: options.per,
      keyBy: options.keyBy,
      overridable: options.overridable ?? false,
      ...(options.description !== undefined ? { description: options.description } : {}),
    };
  },
};
