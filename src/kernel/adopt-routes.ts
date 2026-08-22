/**
 * Type-level (and runtime) route accumulation for `.adopt({ notes })`.
 *
 * Registration still happens in {@link on}; adopt makes the composition root
 * honest and stamps `$routes` so `typeof app` carries every flow contract.
 */

import type { InferSchemaOutput } from "../validation/standard-schema.ts";
import type { AnyFlowDef, FlowDef, FlowErrorMap } from "./flow.ts";
import { isFlow } from "./flow.ts";
import type { HttpTrigger, LiveHttpTrigger, Trigger } from "./triggers.ts";
import { httpPathParams } from "./live-http.ts";

/**
 * One flow's route contract on `app.$routes` (compatible with client
 * {@link import("../client/types.ts").FlowContract}).
 *
 * `in` / `out` / `errors` are type-level phantoms (absent at runtime).
 * `method` / `path` are present at runtime for HTTP triggers.
 */
export type AppFlowRoute<
  I = unknown,
  O = unknown,
  E extends Record<string, unknown> = Record<string, unknown>,
  M extends string | undefined = undefined,
  P extends string | undefined = undefined,
> = [M, P] extends [string, string]
  ? {
      readonly in?: I;
      readonly out?: O;
      readonly errors?: E;
      readonly method: M;
      readonly path: P;
    }
  : {
      readonly in?: I;
      readonly out?: O;
      readonly errors?: E;
      readonly method?: undefined;
      readonly path?: undefined;
    };

/**
 * Unit → flow → contract. Leaf is the HTTP / call-only union — do not
 * index with `AppFlowRoute<any, any, any, any, any>` (`any extends string`
 * makes `method`/`path` required and rejects cron / signal flows).
 */
export type AppRouteMap = {
  readonly [unit: string]: {
    readonly [flow: string]: {
      readonly in?: unknown;
      readonly out?: unknown;
      readonly errors?: unknown;
      readonly method?: string;
      readonly path?: string;
      readonly live?: string;
      readonly matchKey?: readonly string[];
      readonly gates?: readonly string[];
      readonly stream?: true;
    };
  };
};

/** Namespace object: export name → FlowDef (e.g. `import * as notes`). */
export type FlowNamespace = {
  readonly [flow: string]: AnyFlowDef;
};

/** One `.adopt(...)` argument — a namespace bag or a single untriggered flow. */
export type AdoptArg = FlowNamespace | Record<string, FlowNamespace> | AnyFlowDef;

/**
 * Map error schemas to their validated output shapes for the client.
 *
 * @typeParam E - Flow error schema map
 */
export type ErrorDataOf<E extends FlowErrorMap> = {
  [K in keyof E]: InferSchemaOutput<E[K]>;
};

/**
 * HTTP live exposure on `$routes` so `createClient(app)` types
 * `api.unit.flow(input, { onEvent })` as subscribe, not JSON RPC.
 *
 * @typeParam I - Input
 * @typeParam O - Output
 * @typeParam E - Error map
 * @typeParam M - HTTP method
 * @typeParam P - Path
 */
export type LiveAppFlowRoute<
  I = unknown,
  O = unknown,
  E extends Record<string, unknown> = Record<string, unknown>,
  M extends string = string,
  P extends string = string,
> = AppFlowRoute<I, O, E, M, P> & {
  readonly live: string;
  readonly stream: true;
  readonly matchKey: readonly string[];
};

/**
 * Derive a client route contract from a {@link FlowDef} (trigger → REST).
 *
 * @typeParam F - Flow definition
 */
export type RouteFromFlow<F> =
  F extends FlowDef<infer I, infer O, infer E, any, infer T>
    ? [T] extends [LiveHttpTrigger<infer M, infer P>]
      ? LiveAppFlowRoute<I, O, ErrorDataOf<E>, M, P>
      : [T] extends [HttpTrigger<infer M, infer P>]
        ? AppFlowRoute<I, O, ErrorDataOf<E>, M, P>
        : AppFlowRoute<I, O, ErrorDataOf<E>>
    : never;

/**
 * Map a flow namespace (`{ create, get, … }`) to a unit route table.
 *
 * @typeParam N - Namespace of flows
 */
export type RoutesFromNamespace<N> = {
  [F in keyof N]: N[F] extends AnyFlowDef ? RouteFromFlow<N[F]> : never;
};

/**
 * Routes contributed by one `.adopt` argument.
 *
 * - `{ notes }` where `notes` is a flow namespace → `{ notes: { create, get, … } }`
 * - A bare {@link FlowDef} → `{}` (fx.call only; no client unit)
 *
 * @typeParam A - Adopt argument
 */
export type RoutesFromAdoptArg<A> = A extends AnyFlowDef
  ? {}
  : A extends FlowNamespace
    ? // Bare namespace without a unit key — not used; adopt always wraps `{ unit: ns }`
      {}
    : {
        [U in keyof A]: A[U] extends AnyFlowDef
          ? never
          : A[U] extends Record<string, AnyFlowDef>
            ? RoutesFromNamespace<A[U]>
            : never;
      };

/**
 * Merge route maps from a variadic `.adopt(...)` argument list.
 *
 * @typeParam Args - Adopt argument tuple
 */
export type RoutesFromAdoptArgs<Args extends readonly unknown[]> = Args extends readonly []
  ? {}
  : Args extends readonly [infer H, ...infer T]
    ? RoutesFromAdoptArg<H> & RoutesFromAdoptArgs<T>
    : {};

/** Runtime leaf: method/path when the flow has an HTTP trigger. */
export interface RuntimeFlowRoute {
  readonly method?: string;
  readonly path?: string;
  /** SSE live signal name when the trigger used `.live(signal)`. */
  readonly live?: string;
  /** Sorted auto-match path-param names (empty = firehose). */
  readonly matchKey?: readonly string[];
  /** Flattened gate names on the HTTP trigger. */
  readonly gates?: readonly string[];
  /** True when this flow returns `text/event-stream`. */
  readonly stream?: true;
}

/** Runtime `$routes` table (values; types live on {@link OkeApp}). */
export type RuntimeRouteMap = {
  [unit: string]: {
    [flow: string]: RuntimeFlowRoute;
  };
};

/**
 * Build a runtime route leaf from a flow's bound HTTP trigger.
 *
 * @param flowDef - Flow definition
 */
export function runtimeRouteFromFlow(flowDef: AnyFlowDef): RuntimeFlowRoute {
  const trigger: Trigger | undefined = flowDef.$trigger ?? flowDef.triggers[0];
  if (trigger?.kind !== "http") return {};
  const liveName = trigger.liveSignal?.name ?? flowDef.live;
  const gates = trigger.gates.map((g) => (typeof g === "string" ? g : g.name));
  return {
    method: trigger.method,
    path: trigger.path,
    ...(liveName !== undefined
      ? {
          live: liveName,
          stream: true as const,
          matchKey: httpPathParams(trigger.path),
          ...(gates.length > 0 ? { gates } : {}),
        }
      : {}),
  };
}

/**
 * Merge namespace objects into a runtime `$routes` map and collect flows.
 *
 * @param args - `.adopt` arguments
 * @param into - Mutable route map to extend
 * @returns Flows discovered (for `fx.call` registration)
 */
export function accumulateAdoptArgs(args: readonly unknown[], into: RuntimeRouteMap): AnyFlowDef[] {
  const found: AnyFlowDef[] = [];

  for (const arg of args) {
    if (isFlow(arg)) {
      found.push(arg);
      continue;
    }
    if (typeof arg !== "object" || arg === null) continue;

    for (const [unit, value] of Object.entries(arg as Record<string, unknown>)) {
      if (isFlow(value)) {
        // Flat `{ create: flow }` without a unit wrapper — skip client map
        found.push(value);
        continue;
      }
      if (typeof value !== "object" || value === null) continue;

      const unitBag = into[unit] ?? (into[unit] = {});
      for (const [flowName, flowDef] of Object.entries(value as Record<string, unknown>)) {
        if (!isFlow(flowDef)) continue;
        stampAdoptedFlow(flowDef, unit, flowName);
        found.push(flowDef);
        unitBag[flowName] = runtimeRouteFromFlow(flowDef);
      }
    }
  }

  return found;
}

/**
 * Stamp `unit.export` on nameless flows — same rule as {@link unit}.
 *
 * @param flowDef - Flow to stamp
 * @param unit - Client unit (folder / adopt key)
 * @param exportName - Namespace export
 */
function stampAdoptedFlow(flowDef: AnyFlowDef, unit: string, exportName: string): void {
  const f = flowDef as { name: string; unit: string | undefined };
  if (!f.name || f.name.startsWith("flow_")) {
    f.name = `${unit}.${exportName}`;
  }
  if (!f.unit) {
    f.unit = unit;
  }
}
