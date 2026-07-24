/**
 * `flow` — the one species of backend behavior.
 *
 * A Flow is a typed contract (`in` / `out` / `errors`) plus a `do` body.
 * Triggers are attached by {@link on}; a flow with no trigger is still a
 * Flow and is callable via `fx.call` (unified-theory §4, Linkly ⑤).
 */

import type { Effects, Slo } from "../manifest/types.ts";
import type { SchemaInput } from "../validation/standard-schema.ts";
import type { FlowFailure } from "./errors.ts";
import type { Fx } from "./fx.ts";
import type { HookFn, HookStage } from "./hooks.ts";
import type { PluginDef } from "./plugin.ts";
import type { Trigger } from "./triggers.ts";

export type {
  SchemaInput,
  StandardSchemaV1,
} from "../validation/standard-schema.ts";

/** Result of a Standard Schema validate call (re-export shape). */
export type StandardSchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<{ readonly message: string }> };

/** Map of declared flow-boundary error names to their schemas. */
export type FlowErrorMap = Readonly<Record<string, SchemaInput>>;

/**
 * Body of a Flow. Receives validated input and the `fx` door.
 *
 * @typeParam I - Input type
 * @typeParam O - Output type
 */
export type FlowHandler<I = unknown, O = unknown> = (
  input: I,
  fx: Fx,
) => O | FlowFailure | Promise<O | FlowFailure>;

/** Options for {@link flow}. */
export interface FlowOptions<
  I = unknown,
  O = unknown,
  E extends FlowErrorMap = FlowErrorMap,
> {
  /** Optional stable name (used by `fx.call` and the Manifest). */
  readonly name?: string;
  /** Optional unit scope for unit-level hooks. */
  readonly unit?: string;
  /** Input schema (Standard Schema when present). */
  readonly in?: SchemaInput;
  /** Output schema (Standard Schema when present). */
  readonly out?: SchemaInput;
  /** Declared typed errors. */
  readonly errors?: E;
  /** Declared effects (capability token). Inferred later by AoT. */
  readonly effects?: Effects;
  /** Journal every effect call. */
  readonly durable?: boolean;
  /** Live-query / push result. */
  readonly live?: boolean;
  /** Cache TTL (`true` = default policy, or a duration string). */
  readonly cache?: boolean | string;
  /** Declared service-level objective. */
  readonly slo?: Slo;
  /** The behavior. */
  readonly do: FlowHandler<I, O>;
}

/**
 * A Flow definition — one species, trigger-agnostic.
 *
 * @typeParam I - Input type
 * @typeParam O - Output type
 * @typeParam E - Error map
 */
export interface FlowDef<
  I = unknown,
  O = unknown,
  E extends FlowErrorMap = FlowErrorMap,
  D extends Record<string, unknown> = {},
> {
  /** Brand for type guards. */
  readonly [flowBrand]: true;
  /** Stable name (auto-assigned when omitted). */
  readonly name: string;
  /** Optional unit scope. */
  readonly unit: string | undefined;
  /** Input schema. */
  readonly in: SchemaInput | undefined;
  /** Output schema. */
  readonly out: SchemaInput | undefined;
  /** Declared errors. */
  readonly errors: E | undefined;
  /** Declared effects. */
  readonly effects: Effects | undefined;
  /** Durability flag. */
  readonly durable: boolean;
  /** Live flag. */
  readonly live: boolean;
  /** Cache option. */
  readonly cache: boolean | string | undefined;
  /** SLO. */
  readonly slo: Slo | undefined;
  /** Handler body. */
  readonly do: FlowHandler<I, O>;
  /** Triggers bound via {@link on} (zero or more). */
  readonly triggers: readonly Trigger[];
  /** Flow-scoped hooks, registration order. */
  readonly hooks: Readonly<Partial<Record<HookStage, readonly HookFn[]>>>;
  /**
   * Plugins queued via {@link FlowDef.plug} until an app registry adopts them.
   * @internal
   */
  readonly pendingPlugins: readonly PluginDef[];
  /** Accumulated decoration types from `.plug()` (type-level only). */
  readonly decorations?: D;
  /**
   * Register a flow-scoped hook (registration order, no priority numbers).
   *
   * @param stage - Pipeline stage
   * @param fn - Hook function
   */
  hook(stage: HookStage, fn: HookFn): FlowDef<I, O, E, D>;
  /**
   * Attach a plugin to this flow only. Scope is the attachment point.
   *
   * @param pluginDef - Plugin from {@link plugin}
   */
  plug<P extends PluginDef>(
    pluginDef: P,
  ): FlowDef<
    I,
    O,
    E,
    D & (P extends PluginDef<infer PD> ? PD : Record<string, never>)
  >;
}

/** Unique brand symbol for {@link FlowDef}. */
export const flowBrand: unique symbol = Symbol("oke.flow");

let flowSeq = 0;

/**
 * Define a Flow — the one species of backend behavior.
 *
 * @param options - Contract and handler
 */
export function flow<
  I = unknown,
  O = unknown,
  E extends FlowErrorMap = FlowErrorMap,
>(options: FlowOptions<I, O, E>): FlowDef<I, O, E> {
  const name = options.name ?? `flow_${++flowSeq}`;
  const triggers: Trigger[] = [];
  const hooks: Partial<Record<HookStage, HookFn[]>> = {};
  const pendingPlugins: PluginDef[] = [];

  const def: FlowDef<I, O, E> = {
    [flowBrand]: true,
    name,
    unit: options.unit,
    in: options.in,
    out: options.out,
    errors: options.errors,
    effects: options.effects,
    durable: options.durable ?? false,
    live: options.live ?? false,
    cache: options.cache,
    slo: options.slo,
    do: options.do,
    triggers,
    hooks,
    pendingPlugins,
    hook(stage, fn) {
      const list = hooks[stage] ?? (hooks[stage] = []);
      list.push(fn);
      return def;
    },
    plug(pluginDef) {
      pendingPlugins.push(pluginDef);
      // Decoration accumulate on the interface; runtime object is unchanged.
      return def as never;
    },
  };

  return def;
}

/**
 * Erased flow type for heterogenous registries (`on` bindings, app index).
 * Individual flows keep their `I`/`O` at the declaration site; the registry
 * cannot preserve every specialization without an erased carrier type.
 */
export type AnyFlowDef = FlowDef<any, any, any>;

/**
 * Type guard for {@link FlowDef}.
 *
 * @param value - Unknown value
 */
export function isFlow(value: unknown): value is AnyFlowDef {
  return (
    typeof value === "object" &&
    value !== null &&
    flowBrand in value &&
    (value as AnyFlowDef)[flowBrand] === true
  );
}

/**
 * Reset the auto-name sequence (tests only).
 *
 * @internal
 */
export function resetFlowSeq(): void {
  flowSeq = 0;
}
