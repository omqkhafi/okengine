/**
 * `oke({ name })` — the application shell.
 *
 * Adopts bindings from {@link on}, builds the HTTP router, compiles
 * per-route parse/validate handlers (AoT or dynamic), runs the hook
 * pipeline, and wires `fx.call` to untriggered (and triggered) flows.
 */

import {
  compileRoute,
  encodeExecuteResult,
  encodeFailure,
  type CompiledRoute,
} from "../compiler/index.ts";
import type { Effects } from "../manifest/types.ts";
import { validate } from "../validation/standard-schema.ts";
import {
  isFlow,
  type AnyFlowDef,
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
  appPluginScope,
  applyPlugin,
  flowPluginScope,
  unitPluginScope,
  type AccumulateDecorations,
} from "./plug.ts";
import type { PluginCapabilities, PluginDef } from "./plugin.ts";
import {
  createPluginRegistry,
  type PluginRegistry,
} from "./registry.ts";
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
import { createRunTelemetry } from "./run-telemetry.ts";
import type { RunsRuntime } from "../runs/runtime.ts";

/** Options for {@link oke}. */
export interface OkeOptions {
  /** Application name (Manifest `app`). */
  readonly name: string;
  /** Router preset — `default` (RegExp+Trie) or `edge` (Linear+Trie). */
  readonly router?: RouterPreset;
  /**
   * AoT compile per-route parse/validate handlers (`new Function`).
   * Set `false` on eval-restricted runtimes (Cloudflare / some edge).
   * Default `true`.
   */
  readonly aot?: boolean;
  /** Extra bindings (in addition to the global {@link on} registry). */
  readonly bindings?: readonly Binding[];
  /** Base fx options applied to every invocation. */
  readonly fx?: Omit<CreateFxOptions, "flow" | "effects" | "capability">;
  /**
   * Optional runs store. When set, every execution is recorded as one
   * wide event with zero flow instrumentation.
   */
  readonly runs?: RunsRuntime;
  /**
   * Personal fields to archive (crypto-shred) from the validated input.
   * Keys are input property names; values become ciphertext under the
   * subject key.
   */
  readonly archiveInputFields?: readonly string[];
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

/**
 * Unit-scoped attachment point — hooks and plugins cover this unit only.
 *
 * @typeParam D - Accumulated decoration types from unit `.plug()`
 */
export interface UnitHooks<D extends Record<string, unknown> = {}> {
  /**
   * Register a unit-level hook.
   *
   * @param stage - Pipeline stage
   * @param fn - Hook function
   */
  hook(stage: HookStage, fn: HookFn): UnitHooks<D>;
  /**
   * Attach a plugin to this unit only. Scope is the attachment point.
   *
   * @param pluginDef - Plugin from {@link plugin}
   */
  plug<P extends PluginDef>(
    pluginDef: P,
  ): UnitHooks<AccumulateDecorations<D, P>>;
}

/**
 * Application instance — adopts flows, routes HTTP, runs the pipeline.
 *
 * @typeParam D - Accumulated decoration types from app `.plug()`
 */
export interface OkeApp<D extends Record<string, unknown> = {}> {
  /** App name. */
  readonly name: string;
  /** Whether AoT compilation is enabled. */
  readonly aot: boolean;
  /** Active HTTP router (after build). */
  readonly router: Router<Binding>;
  /** Plugin registry (identity dedup, conflicts, capability capture). */
  readonly plugins: PluginRegistry;
  /**
   * Attach a plugin app-wide. Scope is the attachment point.
   * Types accumulate — decorations are visible on downstream handlers.
   *
   * @param pluginDef - Plugin from {@link plugin}
   */
  plug<P extends PluginDef>(
    pluginDef: P,
  ): OkeApp<AccumulateDecorations<D, P>>;
  /**
   * Captured plugin capabilities for the Manifest.
   */
  pluginCapabilities(): Record<string, PluginCapabilities>;
  /**
   * Register an app-level hook (registration order).
   *
   * @param stage - Pipeline stage
   * @param fn - Hook function
   */
  hook(stage: HookStage, fn: HookFn): OkeApp<D>;
  /**
   * Unit-level attachment point (hooks + plugins).
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
   * @param extras - Request / params / parse flags
   */
  execute(
    flowDef: AnyFlowDef,
    input: unknown,
    trigger: Trigger,
    extras?: {
      readonly request?: Request;
      readonly params?: Record<string, string>;
      /** Skip execute-time schema validation (already done by the HTTP compiler). */
      readonly validated?: boolean;
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
  /**
   * Look up the compiled parse/validate handler for an HTTP binding.
   *
   * @param binding - HTTP binding
   */
  compiledFor(binding: Binding): CompiledRoute | undefined;
}

/**
 * Create an application. Adopts bindings registered via {@link on}.
 *
 * @param options - App name and router preset
 */
export function oke(options: OkeOptions): OkeApp {
  const aot = options.aot !== false;
  const adopted: Binding[] = [
    ...listBindings(),
    ...(options.bindings ?? []),
  ];

  const appHooks: HookMap = {};
  const unitHooks = new Map<string, HookMap>();
  const flowsByName = new Map<string, AnyFlowDef>();
  const compiled = new WeakMap<Binding, CompiledRoute>();
  const pluginRegistry = createPluginRegistry();
  const flushedPlugins = new WeakMap<AnyFlowDef, Set<PluginDef>>();

  const smart = createRouter<Binding>(options.router ?? "default");
  for (const b of adopted) {
    if (b.trigger.kind === "http") {
      smart.add(b.trigger.method, b.trigger.path, b);
      compiled.set(b, compileHttpBinding(b, aot));
    }
  }
  smart.build();
  const router: Router<Binding> = smart;

  function flushFlowPlugins(flowDef: AnyFlowDef): void {
    let done = flushedPlugins.get(flowDef);
    if (!done) {
      done = new Set();
      flushedPlugins.set(flowDef, done);
    }
    for (const p of flowDef.pendingPlugins) {
      if (done.has(p)) continue;
      done.add(p);
      applyPlugin(pluginRegistry, p, flowPluginScope(flowDef));
    }
  }

  function registerFlow(flowDef: AnyFlowDef): void {
    flowsByName.set(flowDef.name, flowDef);
    flushFlowPlugins(flowDef);
  }

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
      readonly validated?: boolean;
    },
  ): Promise<ExecuteResult> {
    registerFlow(flowDef);

    const unitBag =
      flowDef.unit !== undefined ? unitHooks.get(flowDef.unit) : undefined;
    // app (hooks + plugs) → unit (hooks + plugs) → flow (hooks + plugs)
    const hooks = mergeHooks(
      mergeHooks(
        appHooks,
        pluginRegistry.hooksAt("app", flowDef.unit, flowDef.name),
        undefined,
      ),
      mergeHooks(
        unitBag,
        pluginRegistry.hooksAt("unit", flowDef.unit, flowDef.name),
        undefined,
      ),
      mergeHooks(
        flowDef.hooks as HookMap,
        pluginRegistry.hooksAt("flow", flowDef.unit, flowDef.name),
        undefined,
      ),
    );

    const decorations = pluginRegistry.decorationsFor(
      flowDef.unit,
      flowDef.name,
    );

    const ctx: InvocationContext = {
      trigger,
      flow: flowDef,
      input,
      params: extras?.params ? { ...extras.params } : {},
      request: extras?.request,
      state: {},
      decorations,
    };

    const startedAt = options.fx?.now?.() ?? Date.now();
    const telemetry = createRunTelemetry();
    const { fx, ledger } = createFxContext({
      ...options.fx,
      flow: flowDef.name,
      effects: flowDef.effects ?? ({} as Effects),
      runTelemetry: telemetry,
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

    const alreadyValidated = extras?.validated === true;

    const result = await runPipeline(ctx, fx, hooks, async () => {
      if (!alreadyValidated) {
        const parsed = await validate(flowDef.in, ctx.input);
        if (!parsed.ok) return parsed.failure;
        ctx.input = parsed.value;
        return flowDef.do(parsed.value as never, fx);
      }
      return flowDef.do(ctx.input as never, fx);
    });

    const endedAt = options.fx?.now?.() ?? Date.now();

    if (options.runs) {
      const archiveCleartext = archiveFromInput(
        ctx.input,
        options.archiveInputFields,
      );
      await options.runs.record(
        {
          flow: flowDef,
          trigger,
          fx,
          ledger,
          telemetry,
          startedAt,
          endedAt,
          failure: result.failure,
        },
        archiveCleartext,
      );
    }

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
    aot,
    router,
    bindings: adopted,
    plugins: pluginRegistry,
    plug(pluginDef) {
      applyPlugin(pluginRegistry, pluginDef, appPluginScope);
      // Decoration accumulate on the interface; runtime object is unchanged.
      return app as never;
    },
    pluginCapabilities() {
      return pluginRegistry.capabilities();
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
        plug(pluginDef) {
          applyPlugin(pluginRegistry, pluginDef, unitPluginScope(name));
          return handle as never;
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

      let route = compiled.get(binding);
      if (!route && binding.trigger.kind === "http") {
        route = compileHttpBinding(binding, aot);
        compiled.set(binding, route);
      }

      let input: unknown;
      let validated = false;

      if (route) {
        const parsed = await route.parseValidate(request, params);
        if (!parsed.ok) {
          return encodeFailure(parsed.failure);
        }
        input = parsed.input;
        validated = true;
      } else {
        // Non-compiled path (should not happen for HTTP bindings)
        input = undefined;
      }

      const result = await execute(
        binding.flow,
        input,
        binding.trigger,
        { request, params, validated },
      );

      return encodeExecuteResult(result);
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
      registerFlow(flowDef);
      const trigger: Trigger =
        flowDef.triggers[0] ?? ({ kind: "internal" } satisfies InternalTrigger);
      const result = await execute(flowDef, input, trigger);
      if (result.failure) return result.failure;
      return result.output;
    },
    compiledFor(binding) {
      return compiled.get(binding);
    },
  };

  return app;
}

function compileHttpBinding(binding: Binding, aot: boolean): CompiledRoute {
  const trigger = binding.trigger as HttpTrigger;
  const hookFns: Array<(...args: never[]) => unknown> = [];
  for (const list of Object.values(binding.flow.hooks)) {
    if (!list) continue;
    for (const fn of list) {
      hookFns.push(fn as (...args: never[]) => unknown);
    }
  }
  return compileRoute(
    {
      method: trigger.method,
      path: trigger.path,
      handler: binding.flow.do as (...args: never[]) => unknown,
      hooks: hookFns,
      schema: binding.flow.in,
    },
    aot,
  );
}

/**
 * Pull personal fields from validated input for crypto-shred archival.
 *
 * @param input - Validated flow input
 * @param fields - Property names to archive
 */
function archiveFromInput(
  input: unknown,
  fields: readonly string[] | undefined,
): Record<string, string> | undefined {
  if (!fields || fields.length === 0) return undefined;
  if (!input || typeof input !== "object") return undefined;
  const obj = input as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const name of fields) {
    const v = obj[name];
    if (typeof v === "string" && v.length > 0) out[name] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** @internal expose smart router type for tests */
export type { HttpTrigger, SmartRouter };
