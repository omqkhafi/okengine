/**
 * `flow` — the one species of backend behavior.
 *
 * A Flow is a typed contract (`in` / `out` / `errors`) plus a `do` body.
 * Triggers are attached by {@link on}; a flow with no trigger is still a
 * Flow and is callable via `fx.call` (unified-theory §4, Linkly ⑤).
 */

import type { Effects, FlowPlane, Slo } from "../manifest/types.ts";
import type { InferSchemaOutput, SchemaInput } from "../validation/standard-schema.ts";
import type { FxRetryOptions } from "./concurrency.ts";
import type { FlowFailure } from "./errors.ts";
import type { Fx } from "./fx.ts";
import type { HookFn, HookStage } from "./hooks.ts";
import type { PluginDef } from "./plugin.ts";
import type { Trigger } from "./triggers.ts";

export type { SchemaInput, StandardSchemaV1 } from "../validation/standard-schema.ts";

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
export interface FlowOptions<I = unknown, O = unknown, E extends FlowErrorMap = FlowErrorMap> {
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
  /**
   * Retry the whole `do` body on thrown errors (same journal session when
   * durable). Prefer {@link Fx.retry} inside {@link Fx.step} for fine control.
   */
  /**
   * Retry the whole `do` body on thrown errors (same journal session when
   * durable). Prefer {@link Fx.retry} inside {@link Fx.step} for fine control.
   */
  readonly retry?: FxRetryOptions;
  /**
   * Cache policy. Read-only flows cache automatically from inferred
   * effects (`true` / omitted). `false` opts out; a duration string
   * (`"30s"`) adds a TTL on top of write invalidation.
   */
  readonly cache?: boolean | string;
  /** Declared service-level objective. */
  readonly slo?: Slo;
  /**
   * Plane — `user` (application) or `operator` (Console).
   * Cross-plane invocation is a compile error.
   */
  readonly plane?: FlowPlane;
  /**
   * Acknowledge intentional Manifest contract breaks for this flow
   * (`oke doctor --diff` / CI gate).
   */
  readonly breaking?: boolean;
  /**
   * Compensation phase after terminal failure on a durable flow.
   * Runs under the same journal session after auto per-step `{ undo }`
   * handlers and before `commit("failed")`. Prefer `fx.step(name, fn, { undo })`
   * for step-local reverse work; use this hook for cross-cutting cleanup.
   * Manual bodies must use distinct `fx.step("undo:…")` names — never reuse
   * forward step names. Never called on retryable attempts or sleep park.
   */
  readonly compensate?: (
    ctx: {
      readonly input: I;
      readonly error: unknown;
      readonly completedSteps: readonly string[];
    },
    fx: import("./fx.ts").Fx,
  ) => unknown | Promise<unknown>;
  /**
   * When `false`, skip tenant-role scope union even if `fx.tenant.id` is set.
   * Default `true` when `gate.auth.tenant` is on.
   */
  readonly tenantScoped?: boolean;
  /**
   * Mark this HTTP flow as returning `text/event-stream` via `fx.json.stream`
   * (not signal live). Stamps `$routes.stream` for the typed client.
   */
  readonly stream?: true;
  /** The behavior. */
  readonly do: FlowHandler<I, O>;
}

/**
 * Infer validated input from a flow options bag.
 *
 * @typeParam Opts - {@link FlowOptions} / call-site object
 */
export type InferFlowIn<Opts> = Opts extends { readonly in: infer S }
  ? InferSchemaOutput<S>
  : Opts extends { readonly do: FlowHandler<infer I, infer _O> }
    ? I
    : unknown;

/**
 * Infer success output from a flow options bag.
 *
 * @typeParam Opts - {@link FlowOptions} / call-site object
 */
export type InferFlowOut<Opts> = Opts extends { readonly out: infer S }
  ? InferSchemaOutput<S>
  : Opts extends { readonly do: FlowHandler<infer _I, infer O> }
    ? O
    : unknown;

/**
 * Infer the error schema map from a flow options bag.
 *
 * @typeParam Opts - {@link FlowOptions} / call-site object
 */
export type InferFlowErrors<Opts> = Opts extends {
  readonly errors: infer E extends FlowErrorMap;
}
  ? E
  : {};

/**
 * Phantom brand for the bound trigger type parameter. Optional so
 * `FlowDef<…, undefined>` remains assignable into `on()` before rebinding.
 */
declare const triggerPhantom: unique symbol;

/**
 * A Flow definition — one species, trigger-agnostic until {@link on} binds.
 *
 * @typeParam I - Input type
 * @typeParam O - Output type
 * @typeParam E - Error map (schemas)
 * @typeParam D - Accumulated decoration types from `.plug()`
 * @typeParam T - Bound trigger (set by {@link on}; `undefined` when untriggered)
 */
export interface FlowDef<
  I = unknown,
  O = unknown,
  E extends FlowErrorMap = FlowErrorMap,
  D extends Record<string, unknown> = {},
  T extends Trigger | undefined = undefined,
> {
  /** Brand for type guards. */
  readonly [flowBrand]: true;
  /**
   * Type-level bound trigger (phantom). Not read at runtime — use
   * `$trigger` / `triggers[0]` for the value.
   */
  readonly [triggerPhantom]?: T;
  /** Stable name (auto-assigned when omitted). */
  readonly name: string;
  /** Unit scope — derived from `name`'s first dot segment (e.g. `"auth.refresh"` → `"auth"`). */
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
  /** Whole-body retry policy (runtime). */
  readonly retry: FxRetryOptions | undefined;
  /**
   * Live signal name when this HTTP flow streams {@link SignalDecl} SSE.
   */
  readonly live: string | undefined;
  /**
   * True when `.live(signal)` is bound to a custom `do` (not synthesized).
   * Boot uniqueness uses `custom:{flowName}` instead of path-param match.
   */
  readonly liveCustomMatch: boolean;
  /** Cache option. */
  readonly cache: boolean | string | undefined;
  /** SLO. */
  readonly slo: Slo | undefined;
  /** Plane (user vs operator). */
  readonly plane: FlowPlane | undefined;
  /** Intentional contract-break acknowledgement for Manifest Diff. */
  readonly breaking: boolean;
  /**
   * When `false`, this flow is tenant-unaware (no tenant-role scope union).
   * Default `true` when `gate.auth.tenant` is on.
   */
  readonly tenantScoped: boolean | undefined;
  /**
   * True when this HTTP flow returns SSE via `fx.json.stream` (not live signal).
   */
  readonly stream: true | undefined;
  /**
   * Optional compensation phase after terminal durable failure.
   * See {@link FlowOptions.compensate}.
   */
  readonly compensate:
    | ((
        ctx: {
          readonly input: I;
          readonly error: unknown;
          readonly completedSteps: readonly string[];
        },
        fx: import("./fx.ts").Fx,
      ) => unknown | Promise<unknown>)
    | undefined;
  /** Handler body. */
  readonly do: FlowHandler<I, O>;
  /** Triggers bound via {@link on} (zero or more). */
  readonly triggers: readonly Trigger[];
  /**
   * First bound trigger at runtime (`undefined` when untriggered).
   * The precise trigger literal lives in the {@link triggerPhantom} type param.
   */
  readonly $trigger: Trigger | undefined;
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
  hook(stage: HookStage, fn: HookFn): FlowDef<I, O, E, D, T>;
  /**
   * Attach a plugin to this flow only. Scope is the attachment point.
   *
   * @param pluginDef - Plugin from {@link plugin}
   */
  plug<P extends PluginDef>(
    pluginDef: P,
  ): FlowDef<I, O, E, D & (P extends PluginDef<infer PD> ? PD : Record<string, never>), T>;
}

/** Unique brand symbol for {@link FlowDef}. */
export const flowBrand: unique symbol = Symbol("oke.flow");

/**
 * Define a Flow — the one species of backend behavior.
 *
 * Input / output types are inferred from Standard Schema `in` / `out` when
 * present; otherwise from the `do` handler signature.
 *
 * A nameless `flow({ do })` is stamped `unit.export` by the file-tree
 * generator, {@link unit}, or `.adopt()`. Explicit `flow("notes.get", {…})`
 * still wins.
 *
 * @param options - Contract and handler (name stamped later)
 */
export function flow<Opts extends FlowOptions<any, any, any>>(
  options: Opts,
): FlowDef<InferFlowIn<Opts>, InferFlowOut<Opts>, InferFlowErrors<Opts>>;
/**
 * @param name - Stable name (used by `fx.call` and the Manifest)
 * @param options - Contract and handler
 */
export function flow<Opts extends FlowOptions<any, any, any>>(
  name: string,
  options: Opts & { readonly name?: never },
): FlowDef<InferFlowIn<Opts>, InferFlowOut<Opts>, InferFlowErrors<Opts>>;
export function flow(
  nameOrOptions: string | FlowOptions<any, any, any>,
  maybeOptions?: FlowOptions<any, any, any> & { readonly name?: never },
): FlowDef {
  const named = typeof nameOrOptions === "string";
  const name = named ? nameOrOptions : "";
  const options = (named ? maybeOptions : nameOrOptions) as FlowOptions<any, any, any> | undefined;
  if (!options || typeof options.do !== "function") {
    throw new TypeError("flow() expected an options bag with a do handler");
  }

  const triggers: Trigger[] = [];
  const hooks: Partial<Record<HookStage, HookFn[]>> = {};
  const pendingPlugins: PluginDef[] = [];

  const dot = name.indexOf(".");
  const unit = dot > 0 ? name.slice(0, dot) : undefined;

  const def: FlowDef = {
    [flowBrand]: true,
    name,
    unit,
    in: options.in,
    out: options.out,
    errors: (options.errors ?? undefined) as FlowErrorMap | undefined,
    effects: options.effects,
    durable: options.durable ?? false,
    retry: options.retry,
    live: undefined,
    liveCustomMatch: false,
    cache: options.cache,
    slo: options.slo,
    plane: options.plane,
    breaking: options.breaking ?? false,
    tenantScoped: options.tenantScoped,
    stream: options.stream,
    compensate: options.compensate as FlowDef["compensate"],
    do: options.do as FlowHandler,
    triggers,
    $trigger: undefined,
    hooks,
    pendingPlugins,
    hook(stage, fn) {
      const list = hooks[stage] ?? (hooks[stage] = []);
      list.push(fn);
      return def;
    },
    plug(pluginDef) {
      pendingPlugins.push(pluginDef);
      // Decorations accumulate on the interface; runtime object is unchanged.
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
export type AnyFlowDef = FlowDef<any, any, any, any, any>;

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
 * No-op. Nameless flows start as `""` and are stamped by unit / adopt /
 * the file-tree generator — kept so existing test `beforeEach` blocks
 * don't need touching.
 *
 * @internal
 */
export function resetFlowSeq(): void {}
