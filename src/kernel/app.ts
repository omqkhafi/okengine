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
import { validate } from "../validation/standard-schema.ts";
import {
  accumulateAdoptArgs,
  type AppRouteMap,
  type RoutesFromAdoptArgs,
  type RuntimeRouteMap,
} from "./adopt-routes.ts";
// `./boot.ts` pulls in every element + driver module (vault, store, signal,
// clock, gate, channel, ai, runs) — a type-only import here keeps that whole
// graph out of the cold-start path; `doBoot` below loads it lazily, only
// when an app actually boots (AGENTS.md budget: cold start < 50 ms).
import type { BootOptions, BootResult, ElementRuntimes } from "./boot.ts";
import type { CapabilityToken } from "./capability.ts";
import {
  createAppAuthBinding,
  verifyBearerToken,
  type AppAuthBinding,
  type CreateAppAuthBindingOptions,
} from "./auth-resolve.ts";
import { runDurable } from "../elements/clock/durable.ts";
import {
  isFlow,
  type AnyFlowDef,
} from "./flow.ts";
import {
  createFxContext,
  resolveName,
  type CreateFxOptions,
  type Fx,
  type FxAuth,
  type FxOperator,
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
import {
  createJournal,
  createMemoryJournalStore,
  isJournalSuspend,
  type JournalSession,
} from "./journal.ts";
import { listBindings, type Binding } from "./on.ts";
import {
  applyPrincipal,
  createElementPipelineHooks,
  type PrincipalBag,
  type ResolvedPrincipal,
} from "./pipeline.ts";
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
   * Optional runs store, or create options for one. When set, every
   * execution is recorded as one wide event with zero flow instrumentation.
   * After {@link OkeApp.boot}, `bootResult.runs` takes precedence.
   */
  readonly runs?: BootOptions["runs"];
  /**
   * Personal fields to archive (crypto-shred) from the validated input.
   * Keys are input property names; values become ciphertext under the
   * subject key.
   */
  readonly archiveInputFields?: readonly string[];
  /** Active environment for {@link OkeApp.boot} (defaults to `dev`). */
  readonly env?: BootOptions["env"];
  /** Optional `oke.config.ts` document consumed at boot. */
  readonly config?: BootOptions["config"];
  /** Pre-built element runtimes (skip construction at boot when present). */
  readonly elements?: BootOptions["elements"];
  /** Vault create options (chain / allowDevFallbacks / secrets). */
  readonly vault?: BootOptions["vault"];
  /** Vault secret contracts (shorthand for `vault.secrets`). */
  readonly secrets?: BootOptions["secrets"];
  /** Gate declarations for the runtime. */
  readonly gates?: BootOptions["gates"];
  /** Signal declarations. */
  readonly signals?: BootOptions["signals"];
  /** Named clock declarations. */
  readonly clocks?: BootOptions["clocks"];
  /** Store facet declarations to register. */
  readonly stores?: BootOptions["stores"];
  /** Channel runtime options. */
  readonly channel?: BootOptions["channel"];
  /** AI runtime options. */
  readonly ai?: BootOptions["ai"];
  /**
   * Boot automatically on first {@link OkeApp.execute} / {@link OkeApp.fetch}
   * call. Default `false` — call {@link OkeApp.boot} explicitly (tests
   * usually want a fail-fast boot before serving any request).
   */
  readonly autoBoot?: boolean;
  /**
   * Start the background scheduler tick loop at boot.
   * Default: on when `env !== "test"`; off in test. Opt out with `false`.
   */
  readonly startScheduler?: boolean;
  /** Scheduler tick period ms (default 1000). Forwarded to boot. */
  readonly schedulerIntervalMs?: number;
  /**
   * Builtin hybrid-session auth (HMAC access tokens).
   * Required to accept `Authorization: Bearer` in production.
   */
  readonly auth?: CreateAppAuthBindingOptions;
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
 * @typeParam R - Accumulated client route map from `.adopt({ unit })`
 */
export interface OkeApp<
  D extends Record<string, unknown> = {},
  R extends AppRouteMap = {},
> {
  /** App name. */
  readonly name: string;
  /** Whether AoT compilation is enabled. */
  readonly aot: boolean;
  /**
   * Accumulated flow contracts for `createClient<typeof app>`.
   * Type-level `in`/`out`/`errors` + runtime `method`/`path` for HTTP triggers.
   */
  readonly $routes: R;
  /** Active HTTP router (after build). */
  readonly router: Router<Binding>;
  /** Plugin registry (identity dedup, conflicts, capability capture). */
  readonly plugins: PluginRegistry;
  /** Whether {@link OkeApp.boot} has completed. */
  readonly booted: boolean;
  /** Result of {@link OkeApp.boot} (element runtimes, capabilities). */
  readonly bootResult: BootResult | undefined;
  /**
   * Run the ordered boot sequence (vault → store → signal → clock → channel
   * → AI → runs → capabilities). Fails fast — a missing secret throws
   * before a single request can be served. Idempotent: a second call is a
   * no-op once booted.
   *
   * @param overrides - Per-call overrides merged over the constructor options
   */
  boot(overrides?: Partial<BootOptions>): Promise<OkeApp<D, R>>;
  /**
   * Stop the background scheduler and close element runtimes.
   * Safe to call when not booted (no-op).
   */
  stop(): Promise<void>;
  /** Element runtimes after {@link OkeApp.boot} (`undefined` before boot). */
  readonly elements: ElementRuntimes | undefined;
  /** Per-flow capability tokens minted at boot from declared effects. */
  readonly capabilities: ReadonlyMap<string, CapabilityToken>;
  /**
   * Builtin auth binding after boot (session store + secret), when configured.
   */
  readonly authBinding: AppAuthBinding | undefined;
  /**
   * Attach a plugin app-wide. Scope is the attachment point.
   * Types accumulate — decorations are visible on downstream handlers.
   *
   * @param pluginDef - Plugin from {@link plugin}
   */
  plug<P extends PluginDef>(
    pluginDef: P,
  ): OkeApp<AccumulateDecorations<D, P>, R>;
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
  hook(stage: HookStage, fn: HookFn): OkeApp<D, R>;
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
   * Adopt namespace objects and/or untriggered flows.
   *
   * - `.adopt({ notes })` — namespace key is the client unit; export names are
   *   methods. Accumulates contracts into {@link OkeApp.$routes}.
   * - `.adopt(stats)` — registers an untriggered flow for `fx.call` only.
   * - Variadic: `.adopt({ notes }, { bookings })`.
   *
   * Registration of HTTP bindings still happens in {@link on}; adopt makes
   * the composition root honest and carries types for the client.
   *
   * @param args - Namespace bags and/or individual flows
   */
  adopt<const Args extends readonly unknown[]>(
    ...args: Args
  ): OkeApp<D, R & RoutesFromAdoptArgs<Args>>;
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
      /** Pre-resolved auth principal (test harness / internal dispatch). */
      readonly auth?: ResolvedPrincipal | FxAuth;
      /** Pre-resolved operator principal. */
      readonly operator?: FxOperator;
      /** Pre-resolved principal (either plane). */
      readonly principal?: ResolvedPrincipal;
    },
  ): Promise<ExecuteResult>;
  /**
   * Dispatch an HTTP request through the router + pipeline. Also serves
   * `POST /_oke/:unit/:flow` (internal call bridge) and
   * `GET /_oke/client.json` (routes descriptor for the client).
   *
   * @param request - Web-standard Request
   */
  fetch(request: Request): Promise<Response>;
  /**
   * @internal Resume durable runs whose journaled wake time has elapsed
   * (test harness / clock-driven schedulers).
   *
   * @param now - Epoch-ms to evaluate against (defaults to the app clock)
   */
  resumeDurable(now?: number): Promise<void>;
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
  /**
   * Construction options — used by the test harness to re-bind channel /
   * secrets / gates without re-declaring them.
   */
  readonly $options: OkeOptions;
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
  /** Retained for test harness / boot merges. */
  const $options = options;

  const appHooks: HookMap = {};
  const unitHooks = new Map<string, HookMap>();
  const flowsByName = new Map<string, AnyFlowDef>();
  const compiled = new WeakMap<Binding, CompiledRoute>();
  const pluginRegistry = createPluginRegistry();
  const flushedPlugins = new WeakMap<AnyFlowDef, Set<PluginDef>>();
  /** Runtime route table — types accumulate on the returned {@link OkeApp}. */
  const routes: RuntimeRouteMap = {};

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

  // --- boot (vault → store → signal → clock → channel → AI → runs → caps) ---
  let bootResult: BootResult | undefined;
  let bootPromise: Promise<BootResult> | undefined;
  let bootEnv: BootOptions["env"] = options.env ?? "dev";
  let authBinding: AppAuthBinding | undefined =
    options.auth !== undefined
      ? createAppAuthBinding({
          ...options.auth,
          now: options.fx?.now,
        })
      : undefined;
  const journalStore = createMemoryJournalStore();
  const sleepingRuns = new Map<
    string,
    { readonly flow: AnyFlowDef; readonly input: unknown; readonly wakeAt: number }
  >();
  const EMPTY_CAPABILITIES: ReadonlyMap<string, CapabilityToken> = new Map();

  async function handleCronFire(name: string): Promise<void> {
    await app.dispatchEvery(name);
    // Named clocks (e.g. `clock("expire-stale", { every: "1h" })`) reconcile
    // to a store row whose effective interval may differ from the cron name.
    const row = await bootResult?.clock?.store.get(name);
    if (row?.effectiveEvery && row.effectiveEvery !== name) {
      await app.dispatchEvery(row.effectiveEvery);
    }
  }

  async function handleSignalFire(name: string, payload: unknown): Promise<void> {
    await app.dispatchSignal(name, payload);
  }

  async function doBoot(overrides?: Partial<BootOptions>): Promise<BootResult> {
    const { bootApplication } = await import("./boot.ts");
    bootEnv = overrides?.env ?? options.env ?? "dev";
    const merged: BootOptions = {
      env: bootEnv,
      config: overrides?.config ?? options.config,
      elements: overrides?.elements ?? options.elements,
      secrets: overrides?.secrets ?? options.secrets,
      vault: overrides?.vault ?? options.vault,
      gates: overrides?.gates ?? options.gates,
      signals: overrides?.signals ?? options.signals,
      clocks: overrides?.clocks ?? options.clocks,
      stores: overrides?.stores ?? options.stores,
      channel: overrides?.channel ?? options.channel,
      ai: overrides?.ai ?? options.ai,
      runs: overrides?.runs ?? options.runs,
      now: overrides?.now ?? options.fx?.now,
      instanceId: overrides?.instanceId,
      startScheduler: overrides?.startScheduler ?? options.startScheduler,
      schedulerIntervalMs:
        overrides?.schedulerIntervalMs ?? options.schedulerIntervalMs,
      bindings: adopted,
      flows: [...flowsByName.values()],
      onCronFire: overrides?.onCronFire ?? handleCronFire,
      onSignal: overrides?.onSignal ?? handleSignalFire,
    };
    const result = await bootApplication(merged);
    bootResult = result;
    // Prefer the booted clock for access-token expiry checks.
    if (authBinding) {
      authBinding = createAppAuthBinding({
        secret: authBinding.secret,
        sessions: authBinding.sessions,
        now: result.clock?.now.bind(result.clock) ?? authBinding.now,
      });
    }
    return result;
  }

  /**
   * Boot lazily when `autoBoot` is enabled; otherwise legacy (pre-boot)
   * execution continues to work without gates / element runtimes — existing
   * callers that never call {@link OkeApp.boot} see unchanged behavior.
   */
  async function ensureBoot(): Promise<BootResult | undefined> {
    if (bootResult) return bootResult;
    if (options.autoBoot !== true) return undefined;
    if (!bootPromise) {
      bootPromise = doBoot();
    }
    return bootPromise;
  }

  function isRunsRuntimeLike(
    value: OkeOptions["runs"],
  ): value is RunsRuntime {
    return (
      typeof value === "object" &&
      value !== null &&
      "record" in value &&
      typeof (value as RunsRuntime).record === "function"
    );
  }

  async function execute(
    flowDef: AnyFlowDef,
    input: unknown,
    trigger: Trigger,
    extras?: {
      readonly request?: Request;
      readonly params?: Record<string, string>;
      readonly validated?: boolean;
      readonly auth?: ResolvedPrincipal | FxAuth;
      readonly operator?: FxOperator;
      readonly principal?: ResolvedPrincipal;
    },
  ): Promise<ExecuteResult> {
    registerFlow(flowDef);

    const booted = await ensureBoot();

    const unitBag =
      flowDef.unit !== undefined ? unitHooks.get(flowDef.unit) : undefined;
    // app (hooks + plugs) → unit (hooks + plugs) → flow (hooks + plugs)
    const composedHooks = mergeHooks(
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

    const now = options.fx?.now ?? booted?.clock?.now ?? (() => Date.now());
    const startedAt = now();
    const telemetry = createRunTelemetry();

    // Element pipeline wiring only kicks in once booted — pre-boot execution
    // (existing tests) runs exactly as before, with no gates / elements.
    let principals: PrincipalBag | undefined;
    let hooks: HookMap = composedHooks;
    let capability: CapabilityToken | undefined;
    let journalSession: JournalSession | undefined;

    if (booted) {
      principals = {
        auth: {
          userId: options.fx?.auth?.userId ?? null,
          scopes: new Set(options.fx?.auth?.scopes ?? []),
          verified: options.fx?.auth?.verified,
        },
        operator: { id: options.fx?.operator?.id ?? null },
      };

      // extras.principal / extras.auth are test-harness only — never from
      // a real HTTP request in production mode.
      const testMode = bootEnv === "test";
      if (testMode) {
        applyPrincipal(
          principals,
          extras?.auth as ResolvedPrincipal | undefined,
        );
        applyPrincipal(principals, extras?.principal);
        if (extras?.operator) principals.operator.id = extras.operator.id;
      }

      const binding = authBinding;
      const elementHooks = createElementPipelineHooks({
        gates: booted.gate,
        principals,
        telemetry,
        allowTestPrincipals: testMode,
        verifyBearer: binding
          ? (token) => verifyBearerToken(binding, token)
          : undefined,
      });

      // Element hooks run first in the app-level onAuth/beforeHandle chain —
      // principal resolution and gate checks precede user-registered hooks.
      hooks = mergeHooks(
        {
          onAuth: [elementHooks.onAuth],
          beforeHandle: [elementHooks.beforeHandle],
        },
        composedHooks,
        undefined,
      );

      capability = booted.capabilities.get(flowDef.name);

      if (flowDef.durable) {
        const journal = createJournal({ store: journalStore, now });
        journalSession = await journal.start(flowDef.name, input);
      }
    }

    const { fx, ledger } = createFxContext({
      ...options.fx,
      flow: flowDef.name,
      effects: flowDef.effects,
      runTelemetry: telemetry,
      now,
      ...(principals
        ? { auth: principals.auth as FxAuth, operator: principals.operator }
        : {}),
      ...(capability ? { capability } : {}),
      ...(booted
        ? {
            storeRuntime: booted.store,
            signalRuntime: booted.signal,
            vaultRuntime: booted.vault,
            channelRuntime: booted.channel,
            aiRuntime: booted.ai,
          }
        : {}),
      ...(journalSession ? { journal: journalSession, durable: true } : {}),
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
      try {
        if (!alreadyValidated) {
          const parsed = await validate(flowDef.in, ctx.input);
          if (!parsed.ok) return parsed.failure;
          ctx.input = parsed.value;
          return await flowDef.do(parsed.value as never, fx);
        }
        return await flowDef.do(ctx.input as never, fx);
      } catch (err) {
        // A durable sleep that has not yet elapsed suspends the run — this
        // is a park, not a pipeline failure, so it must not throw upward.
        if (flowDef.durable && journalSession && isJournalSuspend(err)) {
          ctx.state.sleeping = {
            wakeAt: err.wakeAt,
            label: err.label,
            runId: journalSession.runId,
          };
          return undefined;
        }
        throw err;
      }
    });

    const endedAt = now();

    if (journalSession) {
      const sleeping = ctx.state.sleeping as
        | { readonly wakeAt: number; readonly label: string; readonly runId: string }
        | undefined;
      if (sleeping) {
        sleepingRuns.set(sleeping.runId, {
          flow: flowDef,
          input: ctx.input,
          wakeAt: sleeping.wakeAt,
        });
      } else if (result.failure) {
        await journalSession.commit("failed", {
          error: result.failure.error.code,
        });
      } else {
        await journalSession.commit("completed", { output: result.output });
      }
    }

    const runsRuntime =
      booted?.runs ??
      (isRunsRuntimeLike(options.runs) ? options.runs : undefined);
    if (runsRuntime) {
      const archiveCleartext = archiveFromInput(
        ctx.input,
        options.archiveInputFields,
      );
      await runsRuntime.record(
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
    $routes: routes as OkeApp["$routes"],
    router,
    bindings: adopted,
    $options,
    plugins: pluginRegistry,
    get booted() {
      return bootResult !== undefined;
    },
    get bootResult() {
      return bootResult;
    },
    get elements() {
      if (!bootResult) return undefined;
      return {
        vault: bootResult.vault,
        store: bootResult.store,
        signal: bootResult.signal,
        clock: bootResult.clock,
        gate: bootResult.gate,
        channel: bootResult.channel,
        ai: bootResult.ai,
        runs: bootResult.runs,
      };
    },
    get capabilities() {
      return bootResult?.capabilities ?? EMPTY_CAPABILITIES;
    },
    async boot(overrides) {
      if (bootResult) return app;
      if (!bootPromise) {
        bootPromise = doBoot(overrides);
      }
      await bootPromise;
      return app;
    },
    async stop() {
      if (!bootResult) return;
      bootResult.stopScheduler();
      await bootResult.close();
      bootResult = undefined;
      bootPromise = undefined;
    },
    get authBinding() {
      return authBinding;
    },
    async resumeDurable(now) {
      const t = now ?? bootResult?.clock?.now() ?? options.fx?.now?.() ?? Date.now();
      for (const [runId, sleeper] of [...sleepingRuns.entries()]) {
        if (t < sleeper.wakeAt) continue;
        sleepingRuns.delete(runId);
        const result = await runDurable({
          flow: sleeper.flow,
          input: sleeper.input,
          journalStore,
          runId,
          now: () => t,
          fx: {
            storeRuntime: bootResult?.store,
            signalRuntime: bootResult?.signal,
            vaultRuntime: bootResult?.vault,
            channelRuntime: bootResult?.channel,
            aiRuntime: bootResult?.ai,
          },
        });
        if (result.status === "sleeping") {
          sleepingRuns.set(runId, {
            flow: sleeper.flow,
            input: sleeper.input,
            wakeAt: result.wakeAt,
          });
        }
      }
    },
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
    adopt(...args: readonly unknown[]) {
      const flows = accumulateAdoptArgs(args, routes);
      for (const flowDef of flows) {
        registerFlow(flowDef);
      }
      // Route map types accumulate on the interface; runtime `routes` mutates in place.
      return app as never;
    },
    execute,
    async fetch(request) {
      const url = new URL(request.url);
      const method = request.method.toUpperCase();

      if (method === "GET" && url.pathname === "/_oke/client.json") {
        return new Response(JSON.stringify(routes), {
          headers: { "content-type": "application/json" },
        });
      }

      if (method === "POST" && url.pathname.startsWith("/_oke/")) {
        const rest = url.pathname.slice("/_oke/".length);
        const parts = rest.split("/").filter((p) => p.length > 0);
        if (parts.length >= 2) {
          const [unit, ...flowParts] = parts;
          const flowName = flowParts.join("/");
          const target =
            flowsByName.get(`${unit}.${flowName}`) ?? flowsByName.get(flowName);
          if (!target) {
            return new Response("Not Found", { status: 404 });
          }
          let internalInput: unknown;
          try {
            internalInput = await request.json();
          } catch {
            internalInput = undefined;
          }
          const internalResult = await execute(
            target,
            internalInput,
            { kind: "internal" } satisfies InternalTrigger,
            { request },
          );
          return encodeExecuteResult(internalResult);
        }
      }

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
