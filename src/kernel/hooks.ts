/**
 * Seven-stage hook pipeline (unified-theory §12).
 *
 * ```
 * onRequest → onParse → onAuth → beforeHandle → handler
 *   → afterHandle → onError → onResponse
 * ```
 *
 * Composable at app, unit, and flow level — in that order. Within a level,
 * registration order wins; there are no priority numbers. Any hook may
 * short-circuit by returning a {@link Response} or a {@link FlowFailure}.
 */

import type { AnyFlowDef } from "./flow.ts";
import type { FlowFailure } from "./errors.ts";
import type { Fx } from "./fx.ts";
import { pluginIdOfHook, recordHookCost } from "./hook-timing.ts";
import type { Trigger } from "./triggers.ts";

/**
 * Pipeline stages in documented order.
 * `handler` is the flow body slot (not user-registrable as a hook name
 * for replacing the flow — it appears in the trace of stages).
 */
export type HookStage =
  | "onRequest"
  | "onParse"
  | "onAuth"
  | "beforeHandle"
  | "afterHandle"
  | "onError"
  | "onResponse";

/** Stages that run before the flow body. */
export const BEFORE_HANDLER_STAGES: readonly HookStage[] = [
  "onRequest",
  "onParse",
  "onAuth",
  "beforeHandle",
] as const;

/** Stages that run after a successful handler (before onResponse). */
export const AFTER_HANDLER_STAGES: readonly HookStage[] = ["afterHandle"] as const;

/** All user-registrable stages in pipeline order. */
export const HOOK_STAGES: readonly HookStage[] = [
  "onRequest",
  "onParse",
  "onAuth",
  "beforeHandle",
  "afterHandle",
  "onError",
  "onResponse",
] as const;

/** Mutable invocation context passed through the pipeline. */
export interface InvocationContext {
  /** Active trigger for this invocation. */
  readonly trigger: Trigger;
  /** Flow being executed. */
  readonly flow: AnyFlowDef;
  /** Raw input (body / payload / params merge). */
  input: unknown;
  /** Path params from the router (HTTP). */
  params: Record<string, string>;
  /** Optional HTTP request. */
  request?: Request;
  /** Result from the flow body (when not a failure). */
  result?: unknown;
  /** Flow-boundary failure or thrown value. */
  error?: unknown;
  /** Response short-circuit or final HTTP response. */
  response?: Response;
  /** Arbitrary per-request bag. */
  readonly state: Record<string, unknown>;
  /**
   * Context decorations from plugins in scope (app → unit → flow).
   * Types accumulate through `.plug()`.
   */
  readonly decorations: Record<string, unknown>;
}

/**
 * Hook function. Return a {@link Response} or {@link FlowFailure} to
 * short-circuit; return void to continue.
 *
 * @param ctx - Invocation context
 * @param fx - The `fx` door for this invocation
 */
/**
 * Standard hook — `(ctx, fx)`.
 * `onError` may also be declared as `(ctx, err, fx)` (four-applications).
 */
export type HookFn = (
  ctx: InvocationContext,
  fxOrErr: Fx | unknown,
  fx?: Fx,
) => void | Response | FlowFailure | Promise<void | Response | FlowFailure>;

/** Hook bag keyed by stage. */
export type HookMap = Partial<Record<HookStage, HookFn[]>>;

/**
 * True when `value` is a flow-boundary failure.
 *
 * @param value - Unknown
 */
export function isFlowFailure(value: unknown): value is FlowFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    (value as FlowFailure).data === null &&
    "error" in value &&
    typeof (value as FlowFailure).error === "object" &&
    (value as FlowFailure).error !== null
  );
}

/**
 * Merge hook lists in composition order: app → unit → flow.
 * Within each level, registration order is preserved.
 *
 * @param app - App-level hooks
 * @param unit - Unit-level hooks
 * @param flowHooks - Flow-level hooks
 */
export function mergeHooks(
  app: HookMap | undefined,
  unit: HookMap | undefined,
  flowHooks: HookMap | undefined,
): HookMap {
  const out: HookMap = {};
  for (const stage of HOOK_STAGES) {
    const merged = [
      ...(app?.[stage] ?? []),
      ...(unit?.[stage] ?? []),
      ...(flowHooks?.[stage] ?? []),
    ];
    if (merged.length > 0) out[stage] = merged;
  }
  return out;
}

/** Outcome of running the pipeline. */
export interface PipelineResult {
  readonly ctx: InvocationContext;
  readonly output: unknown;
  readonly failure: FlowFailure | undefined;
  readonly response: Response | undefined;
}

/**
 * Run the seven-stage pipeline around `handler`.
 *
 * @param ctx - Invocation context
 * @param fx - Fx door
 * @param hooks - Merged hooks
 * @param handler - Flow body (the `handler` stage)
 */
export async function runPipeline(
  ctx: InvocationContext,
  fx: Fx,
  hooks: HookMap,
  handler: () => unknown | Promise<unknown>,
): Promise<PipelineResult> {
  let shortCircuit: "response" | "error" | undefined;

  for (const stage of BEFORE_HANDLER_STAGES) {
    const outcome = await runStage(stage, hooks, ctx, fx);
    if (outcome === "response") {
      shortCircuit = "response";
      break;
    }
    if (outcome === "error") {
      shortCircuit = "error";
      break;
    }
  }

  if (shortCircuit === undefined) {
    try {
      const output = await handler();
      if (isFlowFailure(output)) {
        ctx.error = output;
        ctx.result = undefined;
        shortCircuit = "error";
      } else if (output instanceof Response) {
        ctx.response = output;
        ctx.result = undefined;
      } else {
        ctx.result = output;
      }
    } catch (err) {
      ctx.error = err;
      shortCircuit = "error";
    }
  }

  if (shortCircuit !== "error" && shortCircuit !== "response") {
    for (const stage of AFTER_HANDLER_STAGES) {
      const outcome = await runStage(stage, hooks, ctx, fx);
      if (outcome === "response") {
        shortCircuit = "response";
        break;
      }
      if (outcome === "error") {
        shortCircuit = "error";
        break;
      }
    }
  }

  if (shortCircuit === "error" || ctx.error !== undefined) {
    await runStage("onError", hooks, ctx, fx);
  }

  await runStage("onResponse", hooks, ctx, fx);

  const failure = isFlowFailure(ctx.error) ? ctx.error : undefined;
  return {
    ctx,
    output: ctx.result,
    failure,
    response: ctx.response,
  };
}

async function runStage(
  stage: HookStage,
  hooks: HookMap,
  ctx: InvocationContext,
  fx: Fx,
): Promise<"response" | "error" | undefined> {
  const list = hooks[stage];
  if (!list) return undefined;

  for (const fn of list) {
    let returned: void | Response | FlowFailure;
    const pluginId = pluginIdOfHook(fn);
    const started = pluginId !== undefined ? performance.now() : 0;
    try {
      // Spec apps use `.hook("onError", (ctx, err, fx) => …)`.
      returned = stage === "onError" ? await fn(ctx, ctx.error, fx) : await fn(ctx, fx);
    } catch (err) {
      if (pluginId !== undefined) {
        recordHookCost(pluginId, stage, performance.now() - started);
      }
      ctx.error = err;
      return "error";
    }
    if (pluginId !== undefined) {
      recordHookCost(pluginId, stage, performance.now() - started);
    }

    if (returned instanceof Response) {
      ctx.response = returned;
      return "response";
    }
    if (isFlowFailure(returned)) {
      ctx.error = returned;
      return "error";
    }
  }
  return undefined;
}
