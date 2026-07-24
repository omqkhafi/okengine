/**
 * `oke({ name })` — the application shell.
 *
 * Adopts bindings from {@link on}, builds the HTTP router, runs the hook
 * pipeline, and wires `fx.call` to untriggered (and triggered) flows.
 */

import type { Effects } from "../manifest/types.ts";
import {
  isFlow,
  type AnyFlowDef,
  type SchemaInput,
  type StandardSchemaV1,
} from "./flow.ts";
import {
  createFxContext,
  resolveName,
  type CreateFxOptions,
  type Fx,
  type NamedRef,
} from "./fx.ts";
import {
  mergeHooks,
  runPipeline,
  type HookFn,
  type HookMap,
  type HookStage,
  type InvocationContext,
  type PipelineResult,
} from "./hooks.ts";
import { listBindings, type Binding } from "./on.ts";
import {
  createRouter,
  type Router,
  type RouterPreset,
  type SmartRouter,
} from "./router.ts";
import type {
  CdcTrigger,
  EveryTrigger,
  HttpTrigger,
  InternalTrigger,
  SignalAsTrigger,
  Trigger,
} from "./triggers.ts";

/** Options for {@link oke}. */
export interface OkeOptions {
  /** Application name (Manifest `app`). */
  readonly name: string;
  /** Router preset — `default` (RegExp+Trie) or `edge` (Linear+Trie). */
  readonly router?: RouterPreset;
  /** Extra bindings (in addition to the global {@link on} registry). */
  readonly bindings?: readonly Binding[];
  /** Base fx options applied to every invocation. */
  readonly fx?: Omit<CreateFxOptions, "flow" | "effects" | "capability">;
}

/** Payload for a CDC invocation. */
export interface CdcPayload {
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
}

/** Result of executing a flow. */
export interface ExecuteResult {
  readonly output: unknown;
  readonly failure: PipelineResult["failure"];
  readonly response: Response | undefined;
  readonly ctx: InvocationContext;
  readonly fx: Fx;
}

/** Unit-scoped hook registry handle. */
export interface UnitHooks {
  /**
   * Register a unit-level hook.
   *
   * @param stage - Pipeline stage
   * @param fn - Hook function
   */
  hook(stage: HookStage, fn: HookFn): UnitHooks;
}

/**
 * Application instance — adopts flows, routes HTTP, runs the pipeline.
 */
export interface OkeApp {
  /** App name. */
  readonly name: string;
  /** Active HTTP router (after build). */
  readonly router: Router<Binding>;
  /**
   * Plugin placeholder — returns `this` for chaining.
   * Real plugin accumulation lands with the plugin engine.
   *
   * @param _plugin - Plugin value (ignored in v1)
   */
  plug(_plugin?: unknown): OkeApp;
  /**
   * Register an app-level hook (registration order).
   *
   * @param stage - Pipeline stage
   * @param fn - Hook function
   */
  hook(stage: HookStage, fn: HookFn): OkeApp;
  /**
   * Unit-level hook scope.
   *
   * @param name - Unit name
   */
  unit(name: string): UnitHooks;
  /**
   * Look up a flow by name or handle.
   *
   * @param ref - Flow name or `{ name }` / FlowDef
   */
  flow(ref: NamedRef | AnyFlowDef): AnyFlowDef | undefined;
  /**
   * Adopt an untriggered flow so `fx.call` / {@link OkeApp.call} can resolve it.
   *
   * @param flowDef - Flow definition (Linkly ⑤)
   */
  adopt(flowDef: AnyFlowDef): OkeApp;
  /**
   * Execute a flow through the hook pipeline (any trigger kind).
   *
   * @param flowDef - Flow to run
   * @param input - Input payload
   * @param trigger - Trigger for this invocation
   * @param extras - Request / params
   */
  execute(
    flowDef: AnyFlowDef,
    input: unknown,
    trigger: Trigger,
    extras?: {
      readonly request?: Request;
      readonly params?: Record<string, string>;
    },
  ): Promise<ExecuteResult>;
  /**
   * Dispatch an HTTP request through the router + pipeline.
   *
   * @param request - Web-standard Request
   */
  fetch(request: Request): Promise<Response>;
  /**
   * Invoke all flows bound to a signal name.
   *
   * @param signal - Signal name or handle
   * @param payload - Payload
   */
  dispatchSignal(
    signal: NamedRef,
    payload?: unknown,
  ): Promise<ExecuteResult[]>;
  /**
   * Invoke all flows bound to an `every` interval.
   *
   * @param interval - Interval string (e.g. `"1h"`)
   */
  dispatchEvery(interval: string): Promise<ExecuteResult[]>;
  /**
   * Invoke all flows bound to a CDC table change.
   *
   * @param tableName - Table name
   * @param payload - before/after
   * @param column - Optional column filter
   */
  dispatchCdc(
    tableName: string,
    payload: CdcPayload,
    column?: string,
  ): Promise<ExecuteResult[]>;
  /**
   * Call a flow by name/handle (same path as `fx.call`).
   *
   * @param ref - Flow ref
   * @param input - Input
   */
  call(ref: NamedRef | AnyFlowDef, input?: unknown): Promise<unknown>;
  /** All adopted bindings. */
  readonly bindings: readonly Binding[];
}

/**
 * Create an application. Adopts bindings registered via {@link on}.
 *
 * @param options - App name and router preset
 */
export function oke(options: OkeOptions): OkeApp {
  const adopted: Binding[] = [
    ...listBindings(),
    ...(options.bindings ?? []),
  ];

  const appHooks: HookMap = {};
  const unitHooks = new Map<string, HookMap>();
  const flowsByName = new Map<string, AnyFlowDef>();

  const smart = createRouter<Binding>(options.router ?? "default");
  for (const b of adopted) {
    if (b.trigger.kind === "http") {
      smart.add(b.trigger.method, b.trigger.path, b);
    }
  }
  smart.build();
  const router: Router<Binding> = smart;

  function registerFlow(flowDef: AnyFlowDef): void {
    flowsByName.set(flowDef.name, flowDef);
  }

  // Index every flow object that appears (including multi-bind)
  for (const b of adopted) {
    registerFlow(b.flow);
  }

  async function execute(
    flowDef: AnyFlowDef,
    input: unknown,
    trigger: Trigger,
    extras?: {
      readonly request?: Request;
      readonly params?: Record<string, string>;
    },
  ): Promise<ExecuteResult> {
    registerFlow(flowDef);

    const unitBag =
      flowDef.unit !== undefined ? unitHooks.get(flowDef.unit) : undefined;
    const hooks = mergeHooks(appHooks, unitBag, flowDef.hooks as HookMap);

    const ctx: InvocationContext = {
      trigger,
      flow: flowDef,
      input,
      params: extras?.params ? { ...extras.params } : {},
      request: extras?.request,
      state: {},
    };

    const { fx } = createFxContext({
      ...options.fx,
      flow: flowDef.name,
      effects: flowDef.effects ?? ({} as Effects),
      callHandler: async (name, callInput) => {
        const target = flowsByName.get(name);
        if (!target) {
          return undefined;
        }
        const inner = await execute(target, callInput, {
          kind: "internal",
        } satisfies InternalTrigger);
        if (inner.failure) return inner.failure;
        return inner.output;
      },
    });

    const result = await runPipeline(ctx, fx, hooks, async () => {
      const parsed = await maybeParse(flowDef.in, ctx.input);
      ctx.input = parsed;
      return flowDef.do(parsed as never, fx);
    });

    return {
      output: result.output,
      failure: result.failure,
      response: result.response,
      ctx: result.ctx,
      fx,
    };
  }

  const app: OkeApp = {
    name: options.name,
    router,
    bindings: adopted,
    plug(_plugin?: unknown) {
      return app;
    },
    hook(stage, fn) {
      const list = appHooks[stage] ?? (appHooks[stage] = []);
      list.push(fn);
      return app;
    },
    unit(name) {
      let bag = unitHooks.get(name);
      if (!bag) {
        bag = {};
        unitHooks.set(name, bag);
      }
      const handle: UnitHooks = {
        hook(stage, fn) {
          const list = bag![stage] ?? (bag![stage] = []);
          list.push(fn);
          return handle;
        },
      };
      return handle;
    },
    flow(ref) {
      if (isFlow(ref)) return flowsByName.get(ref.name) ?? ref;
      return flowsByName.get(resolveName(ref as NamedRef));
    },
    adopt(flowDef) {
      registerFlow(flowDef);
      return app;
    },
    execute,
    async fetch(request) {
      const url = new URL(request.url);
      const method = request.method.toUpperCase();
      const matched = router.match(method, url.pathname);
      if (!matched) {
        return new Response("Not Found", { status: 404 });
      }
      const { value: binding, params } = matched;
      let body: unknown = undefined;
      if (method !== "GET" && method !== "HEAD") {
        const text = await request.text();
        if (text.length > 0) {
          try {
            body = JSON.parse(text) as unknown;
          } catch {
            body = text;
          }
        }
      }
      const input =
        body !== undefined && typeof body === "object" && body !== null
          ? { ...params, ...(body as Record<string, unknown>) }
          : Object.keys(params).length > 0
            ? { ...params, ...(body !== undefined ? { body } : {}) }
            : body;

      const result = await execute(
        binding.flow,
        input,
        binding.trigger,
        { request, params },
      );

      if (result.response) return result.response;
      if (result.failure) {
        return Response.json(
          { data: null, error: result.failure.error },
          { status: 400 },
        );
      }
      if (result.output === undefined) {
        return new Response(null, { status: 204 });
      }
      return Response.json({ data: result.output, error: null });
    },
    async dispatchSignal(signal, payload) {
      const name = resolveName(signal);
      const results: ExecuteResult[] = [];
      for (const b of adopted) {
        if (b.trigger.kind === "signal" && b.trigger.name === name) {
          results.push(
            await execute(b.flow, payload, b.trigger as SignalAsTrigger),
          );
        }
      }
      return results;
    },
    async dispatchEvery(interval) {
      const results: ExecuteResult[] = [];
      for (const b of adopted) {
        if (b.trigger.kind === "every" && b.trigger.interval === interval) {
          results.push(
            await execute(b.flow, undefined, b.trigger as EveryTrigger),
          );
        }
      }
      return results;
    },
    async dispatchCdc(tableName, payload, column) {
      const results: ExecuteResult[] = [];
      for (const b of adopted) {
        if (b.trigger.kind !== "cdc") continue;
        const t = b.trigger as CdcTrigger;
        if (t.table !== tableName) continue;
        if (column !== undefined && t.column !== undefined && t.column !== column) {
          continue;
        }
        results.push(await execute(b.flow, payload, t));
      }
      return results;
    },
    async call(ref, input) {
      const flowDef = isFlow(ref)
        ? (flowsByName.get(ref.name) ?? ref)
        : flowsByName.get(resolveName(ref as NamedRef));
      if (!flowDef) {
        return undefined;
      }
      // Ensure callable flows are indexed even with zero triggers
      registerFlow(flowDef);
      const trigger: Trigger =
        flowDef.triggers[0] ?? ({ kind: "internal" } satisfies InternalTrigger);
      const result = await execute(flowDef, input, trigger);
      if (result.failure) return result.failure;
      return result.output;
    },
  };

  return app;
}

async function maybeParse(
  schema: SchemaInput | undefined,
  input: unknown,
): Promise<unknown> {
  if (schema === undefined || schema === null) return input;
  if (!isStandardSchema(schema)) return input;
  const result = await schema["~standard"].validate(input);
  if (result.issues) {
    throw new Error(
      `Input validation failed: ${result.issues.map((i) => i.message).join("; ")}`,
    );
  }
  return result.value;
}

function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  return (
    typeof value === "object" &&
    value !== null &&
    "~standard" in value &&
    typeof (value as StandardSchemaV1)["~standard"]?.validate === "function"
  );
}

/** @internal expose smart router type for tests */
export type { HttpTrigger, SmartRouter };
