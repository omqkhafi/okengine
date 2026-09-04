/**
 * `oke({ name })` — the application shell.
 *
 * Adopts bindings from {@link on}, builds the HTTP router, compiles
 * per-route parse/validate handlers (AoT or dynamic), runs the hook
 * pipeline, and wires `fx.call` to untriggered (and triggered) flows.
 */

import { compileRoute } from "../compiler/dynamic.ts";
import type { CompiledRoute } from "../compiler/aot.ts";
import { encodeExecuteResult, encodeFailure } from "../compiler/response.ts";
import { validate } from "../validation/standard-schema.ts";
import {
  accumulateAdoptArgs,
  type AppRouteMap,
  type RoutesFromAdoptArgs,
  type RoutesFromNamespace,
  type RuntimeRouteMap,
} from "./adopt-routes.ts";
import { liveExposureKey, liveGatesKey, liveMatchKeyFromPath } from "./live-http.ts";
// `./boot.ts` pulls in every element + driver module (vault, store, signal,
// clock, gate, channel, ai, runs) — a type-only import here keeps that whole
// graph out of the cold-start path; `doBoot` below loads it lazily, only
// when an app actually boots (AGENTS.md / unified-theory budget: cold start < 75 ms).
import type { BootOptions, BootResult, ElementRuntimes } from "./boot.ts";
import type { CapabilityToken } from "./capability.ts";
import type { AppAuthBinding } from "./auth-resolve.ts";
import type { ApiKeyStore } from "../auth/api-keys.ts";
import type { IdentityStore } from "../auth/identity.ts";
import type { AuthHttpMaterialization } from "../auth/bindings.ts";
import type { WiredGateAuth } from "./app-auth.ts";
import {
  resolveGateConfig,
  type GateOptions,
  type ResolvedGateConfig,
} from "../elements/gate/config.ts";
import { requirePackageModule } from "../shared/lazy-src.ts";
import { lazyRequire } from "./lazy-require.ts";
import type { DurableResult, RunDurableOptions } from "../elements/clock/durable.ts";
import { applyClockTimezoneDefaults } from "../elements/clock/declare.ts";
import type { TemplateCatalog } from "../elements/channel/runtime.ts";
import { parseAcceptLanguage } from "../elements/channel/locale.ts";
import { runWithLocale } from "../i18n/locale-context.ts";
import { isFlow, type AnyFlowDef } from "./flow.ts";
import { failureFromUnknown, runCompensationPhase } from "./compensate.ts";
import { withAbortSignal } from "./abort-scope.ts";
import { withCdcMutationId } from "../elements/store/sql-session.ts";
import { MUTATION_ID_HEADER } from "./realtime-bind.ts";
import { fxRetry } from "./concurrency.ts";
import type {
  CreateFxOptions,
  Fx,
  FxAuth,
  FxContext,
  FxOperator,
  FxPrincipal,
  JsonStreamResult,
  NamedRef,
} from "./fx.ts";
import {
  currentDevSurface,
  failureDetailFromResponse,
  logDevRequest,
  shouldLogDevRequests,
} from "../runtime/dev-request-log.ts";
import { asBrowserJsonCodeBlock, httpNavGroups } from "../runtime/json-code-block.ts";
import { resolveDurationMs } from "./elapsed.ts";
import { fail, throwOke } from "./errors.ts";
import { consumeRegisteredFlowUnits, type FlowUnitBag } from "./flow-units.ts";
import {
  isFlowFailure,
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
  hasJournalLease,
  isJournalLeaseBusy,
  isJournalSuspend,
  JOURNAL_DEFAULT_LEASE_MS,
  type JournalSession,
  type JournalStore,
} from "./journal.ts";
import { releaseInstanceLeases } from "./graceful-shutdown.ts";
import { mintInstanceId } from "./instance-id.ts";
import type { JournalRuntime } from "./boot-bind/journal.ts";
import { listBindings, resetBindings, type Binding } from "./on.ts";
import {
  aiAgentRegistry,
  aiEmbedRegistry,
  aiMcpServerRegistry,
  aiModelRegistry,
  aiPromptRegistry,
  channelTemplateRegistry,
  clockRegistry,
  gateRegistry,
  requiredEnvRegistry,
  secretRegistry,
  signalRegistry,
  storeRegistry,
} from "./element-registries.ts";
import {
  applyPrincipal,
  createElementPipelineHooks,
  gateNamesOf,
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
import { createPluginRegistry, type PluginRegistry } from "./registry.ts";
import {
  createRouter,
  formatAllowHeader,
  type Router,
  type RouterPreset,
  type SmartRouter,
} from "./router.ts";
import { isPendingHttpPath } from "./http-path-pending.ts";
import { drainPendingResourceLiveMounts } from "./resource-live.ts";
import type {
  CdcTrigger,
  HttpTrigger,
  InternalTrigger,
  SignalAsTrigger,
  Trigger,
} from "./triggers.ts";
import { recordObservedEffect } from "./effects.ts";
import { cacheDimensionOf, createRunTelemetry } from "./run-telemetry.ts";
import type { RunsRuntime } from "../runs/runtime.ts";
import type { Effects, ResourceRef } from "../manifest/types.ts";

/**
 * Auto-cache helpers — loaded only when a Store runtime is bound.
 * A static import would pin cache eligibility/dims on every `oke()` graph,
 * including Store-declared apps that never execute a cached flow.
 */
function loadStoreCache(): typeof import("../elements/store/cache.ts") {
  return requirePackageModule("elements/store/cache", "store-cache");
}

/** i18n catalogs — loaded at execute time, not on the `oke()` construction graph. */
function loadMessages(): typeof import("../i18n/messages.ts") {
  return requirePackageModule("i18n/messages", "messages");
}

/**
 * `createFx` / JSON result helpers — loaded on first execute, not on Store-only
 * `oke()` construction (same boundary as `boot.ts`).
 */
function loadFx(): {
  createFxContext: (options: CreateFxOptions) => FxContext;
  freezePrincipal: (p: FxPrincipal) => FxPrincipal;
  isJsonStreamResult: (value: unknown) => value is JsonStreamResult;
  resolveName: (ref: NamedRef) => string;
} {
  return lazyRequire(import.meta.dir, ["fx", "runtime"].join("-"));
}

/** App-shell tenancy wiring — loaded only when `gate.auth.tenant` is on. */
function loadAppTenant(): { w: (kind: number, ...args: unknown[]) => unknown } {
  return lazyRequire(import.meta.dir, ["app", "tenant"].join("-"));
}

/** Durable runner — statically imports `createFx`; keep it off Store-only `oke()`. */
function loadDurable(): {
  runDurable: (opts: RunDurableOptions) => Promise<DurableResult>;
} {
  return lazyRequire(import.meta.dir, ["clock", "durable"].join("-"));
}

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
  /**
   * Extra bindings. Combined with the global {@link on} registry unless
   * {@link OkeOptions.registry} is `"ignore"` — then this is the only source.
   */
  readonly bindings?: readonly Binding[];
  /**
   * How the global {@link on} registry is treated at construction.
   *
   * - `"consume"` (default) — adopt registered bindings, then clear the
   *   registry so a later {@link oke} in the same process cannot inherit
   *   this app's flows.
   * - `"keep"` — adopt registered bindings and leave the registry intact
   *   (legacy behavior).
   * - `"ignore"` — adopt only {@link OkeOptions.bindings}; the registry is
   *   neither read nor cleared (embedding / Console).
   */
  readonly registry?: "consume" | "keep" | "ignore";
  /** Base fx options applied to every invocation. */
  readonly fx?: Omit<CreateFxOptions, "flow" | "effects" | "capability">;
  /**
   * Optional runs store, or create options for one. When set, every
   * execution is recorded as one wide event with zero flow instrumentation.
   * After {@link OkeApp.boot}, `bootResult.runs` takes precedence.
   */
  readonly runs?: BootOptions["runs"];
  /**
   * Push recorded WideEvents to Console ingest (`oke dev` live Traces bridge).
   * See {@link BootOptions.runsBridge}.
   */
  readonly runsBridge?: BootOptions["runsBridge"];
  /**
   * Personal fields to archive (crypto-shred) from the validated input.
   * Keys are input property names; values become ciphertext under the
   * subject key.
   */
  readonly archiveInputFields?: readonly string[];
  /** Active environment for {@link OkeApp.boot} (`dev` / `test` / `prod`). */
  readonly env?: BootOptions["env"];
  /**
   * Compose mode (`oke dev` / `OKE_DOCKER=1`) — select the `dev` driver
   * profile at boot when `env` is omitted.
   */
  readonly docker?: BootOptions["docker"];
  /** Optional `oke.config.ts` document consumed at boot. */
  readonly config?: BootOptions["config"];
  /**
   * Compiled Manifest for flows with no hand-declared `effects` — highest
   * priority source for the boot-time capability stamp (see
   * {@link BootOptions.manifest}).
   */
  readonly manifest?: BootOptions["manifest"];
  /**
   * Project root for a lazy, best-effort effects extraction when a flow has
   * no hand-declared `effects` and no {@link manifest} was given (see
   * {@link BootOptions.rootDir}).
   */
  readonly rootDir?: BootOptions["rootDir"];
  /** Pre-built element runtimes (skip construction at boot when present). */
  readonly elements?: BootOptions["elements"];
  /** Vault create options (chain / allowDevFallbacks / secrets). */
  readonly vault?: BootOptions["vault"];
  /** Vault secret contracts (shorthand for `vault.secrets`). */
  readonly secrets?: BootOptions["secrets"];
  /**
   * Nested Gate bag — auth, policies, rate limits, HTTP posture.
   * Replaces root `auth` / `gates` / `unguardedHttp`.
   */
  readonly gate?: GateOptions;
  /** Signal declarations. */
  readonly signals?: BootOptions["signals"];
  /** Named clock declarations. */
  readonly clocks?: BootOptions["clocks"];
  /**
   * Clock element defaults. `{ timezone: "Asia/Riyadh" }` applies to every
   * `clock()` / helper that omits `timezone` (explicit per-clock wins).
   * Prefer this over repeating `timezone` on each declaration.
   */
  readonly clock?: {
    readonly timezone?: string;
  };
  /** Store facet declarations to register. */
  readonly stores?: BootOptions["stores"];
  /**
   * Store-wide behavior options. `{ live: true }` flips NEW
   * `store.schema.table()` declarations to live-by-default (an automatic
   * CDC + RLS-per-event live stream, same as `.live(table)` /
   * `liveQuery()`) unless a table explicitly opts out with
   * `store.schema.live(false)`. Default `false` — today's explicit-only
   * behavior, zero change to existing apps. Declaration ergonomics only;
   * never the runtime cost model.
   *
   * `{ search: { embed: { model, dims } } }` sets the project default for
   * field `.embed()` so columns can write bare `.embed()` and inherit;
   * per-field `{ model?, dims? }` still overrides.
   */
  readonly store?: {
    readonly live?: boolean;
    readonly search?: {
      readonly embed?: {
        readonly model: { readonly name: string } | string;
        readonly dims: number;
      };
    };
  };
  /** Channel runtime options. */
  readonly channel?: BootOptions["channel"];
  /** AI runtime options. */
  readonly ai?: BootOptions["ai"];
  /**
   * Boot automatically on first {@link OkeApp.execute} / {@link OkeApp.fetch}
   * call. Default `true` — gate posture, vault, capabilities, and the element
   * pipeline must run before any real traffic. Opt out only for intentional
   * pre-boot unit tests: `oke({ autoBoot: false })` skips `doBoot` entirely
   * (no gates / elements) and must never ship as a serving default.
   */
  readonly autoBoot?: boolean;
  /**
   * Start the background scheduler tick loop at boot.
   * Default: on when `env !== "test"`; off in test. Opt out with `false`.
   */
  readonly startScheduler?: boolean;
  /** Scheduler tick period ms (default 1000). Forwarded to boot. */
  readonly schedulerIntervalMs?: number;
  /** Durable-run lease duration ms (default 30_000). Forwarded to boot. */
  readonly journalLeaseMs?: number;
}

/** Readiness probe state — see `GET /_/ready`. */
export type ReadyState = "booting" | "orphan_scan" | "ready";

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
  /** Wide-event cache dimension from this invocation's telemetry. */
  readonly cache: "hit" | "miss" | "none";
  /** Handler duration in milliseconds (high-res; may be fractional). */
  readonly durationMs: number;
  /** WideEvent / run id for this invocation. */
  readonly runId: string;
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
  plug<P extends PluginDef>(pluginDef: P): UnitHooks<AccumulateDecorations<D, P>>;
}

/**
 * Module-augmentation slot filled by `src/flows/generated.ts`.
 * Kernel tests do not import an app generated file, so this stays `{}`.
 */
export interface RegisteredFlowUnits {}

/**
 * `$routes` derived from {@link RegisteredFlowUnits} after `import generated`.
 *
 * @typeParam U - Augmented unit map
 */
export type RoutesFromRegisteredUnits<U = RegisteredFlowUnits> = {
  [K in keyof U]: U[K] extends Record<string, unknown> ? RoutesFromNamespace<U[K]> : never;
};

/**
 * Application instance — adopts flows, routes HTTP, runs the pipeline.
 *
 * @typeParam D - Accumulated decoration types from app `.plug()`
 * @typeParam R - Accumulated client route map from `.adopt({ unit })`
 */
export interface OkeApp<D extends Record<string, unknown> = {}, R extends AppRouteMap = {}> {
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
  /**
   * Readiness for probes — `booting` until boot returns, `orphan_scan` while
   * the durable orphan resume runs, then `ready`. See `GET /_/ready`.
   */
  readonly readyState: ReadyState;
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
  /** Shared API key store when `gate.auth` is enabled. */
  readonly apiKeys: ApiKeyStore | undefined;
  /** Shared identity/credential store when `gate.auth` is enabled. */
  readonly identities: IdentityStore | undefined;
  /**
   * Attach a plugin app-wide. Scope is the attachment point.
   * Types accumulate — decorations are visible on downstream handlers.
   *
   * @param pluginDef - Plugin from {@link plugin}
   */
  plug<P extends PluginDef>(pluginDef: P): OkeApp<AccumulateDecorations<D, P>, R>;
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
      /**
       * Console invoke-as / trusted in-process callers only.
       * When true, `principal` / `auth` injection applies outside `env: "test"`.
       * Must never be set from public HTTP request handling.
       */
      readonly trustedInvoke?: boolean;
      /**
       * Console Operator invoke — skip the flow's gate chain.
       * Takes effect only with {@link trustedInvoke}.
       */
      readonly bypassGates?: boolean;
      /**
       * Console Call API — open store handles with cleartext PII.
       * Takes effect only with {@link trustedInvoke}.
       */
      readonly revealPii?: boolean;
      /** Forced RLS bag (Console / Call API). Operator omit = no stamp. */
      readonly rls?: import("../drivers/pg-rls.ts").RlsIdentity;
      /** Parent WideEvent id when this execution was caused by another. */
      readonly parentId?: string;
      /** Explicit run / WideEvent id (defaults to a new UUID). */
      readonly runId?: string;
      /** Tenant identity for cron / `fx.call` (propagated, unlike auth). */
      readonly tenant?: { readonly id: string | null };
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
   * @param meta - Optional envelope from the bus (producer run id)
   */
  dispatchSignal(
    signal: NamedRef,
    payload?: unknown,
    meta?: { readonly parentRunId?: string; readonly messageId?: string },
  ): Promise<ExecuteResult[]>;
  /**
   * Invoke all flows bound to an `every` interval.
   *
   * @param interval - Interval string (e.g. `"1h"`)
   * @param extras - Optional tenant / parent for per-tenant clocks
   */
  dispatchEvery(
    interval: string,
    extras?: { readonly tenant?: { readonly id: string | null } },
  ): Promise<ExecuteResult[]>;
  /**
   * Invoke all flows bound to a CDC table change.
   *
   * @param tableName - Table name
   * @param payload - before/after
   * @param column - Optional column filter
   */
  dispatchCdc(tableName: string, payload: CdcPayload, column?: string): Promise<ExecuteResult[]>;
  /**
   * Call a flow by name/handle (same path as `fx.call`).
   *
   * @param ref - Flow ref
   * @param input - Input
   */
  call(ref: NamedRef | AnyFlowDef, input?: unknown): Promise<unknown>;
  /**
   * Resolve a user-plane MCP tool exposure by its declared tool name.
   * Returns the bound flow when {@link on}`(`{@link mcp.tool}`(`"name"`).gate(...)`)
   * registered it; `undefined` when absent or ungated (not indexed).
   *
   * @param name - Tool name from `mcp.tool("…")`
   */
  resolveMcpTool(name: string): AnyFlowDef | undefined;
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
 * Concat two decl lists, skipping registry entries already present by
 * reference (the same call-site object explicitly re-passed).
 *
 * @param explicit - Hand-passed decls (kept in order, always wins position)
 * @param fromRegistry - Auto-drained decls to append
 */
function mergeUnique<T>(explicit: readonly T[] | undefined, fromRegistry: readonly T[]): T[] {
  const out: T[] = [...(explicit ?? [])];
  for (const item of fromRegistry) {
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

/**
 * Merge explicit `oke({ ai })` with auto-drained AI decls. Returns
 * `undefined` when neither side contributes — a defined empty object would
 * flip {@link resolveElementNeeds}'s `ai` flag for every app.
 *
 * @param explicit - Hand-passed AI boot options
 * @param fromRegistry - Models / prompts / embeds / agents from declare registries
 */
function mergeAiOptions(
  explicit: BootOptions["ai"] | undefined,
  fromRegistry: {
    readonly models: NonNullable<BootOptions["ai"]>["models"];
    readonly prompts: NonNullable<BootOptions["ai"]>["prompts"];
    readonly embeds: NonNullable<BootOptions["ai"]>["embeds"];
    readonly agents: NonNullable<BootOptions["ai"]>["agents"];
    readonly mcpServers: NonNullable<BootOptions["ai"]>["mcpServers"];
  },
): BootOptions["ai"] | undefined {
  const models = mergeUnique(explicit?.models, fromRegistry.models ?? []);
  const prompts = mergeUnique(explicit?.prompts, fromRegistry.prompts ?? []);
  const embeds = mergeUnique(explicit?.embeds, fromRegistry.embeds ?? []);
  const agents = mergeUnique(explicit?.agents, fromRegistry.agents ?? []);
  const mcpServers = mergeUnique(explicit?.mcpServers, fromRegistry.mcpServers ?? []);
  if (
    explicit === undefined &&
    models.length === 0 &&
    prompts.length === 0 &&
    embeds.length === 0 &&
    agents.length === 0 &&
    mcpServers.length === 0
  ) {
    return undefined;
  }
  return {
    ...(explicit ?? {}),
    ...(models.length > 0 ? { models } : {}),
    ...(prompts.length > 0 ? { prompts } : {}),
    ...(embeds.length > 0 ? { embeds } : {}),
    ...(agents.length > 0 ? { agents } : {}),
    ...(mcpServers.length > 0 ? { mcpServers } : {}),
  };
}

/**
 * Refuse an unresolved path sentinel or a nameless HTTP flow.
 *
 * @param binding - HTTP binding
 */
function assertHttpBindingReady(binding: Binding): void {
  const trigger = binding.trigger;
  if (trigger.kind !== "http") return;
  if (isPendingHttpPath(trigger.path)) {
    throwOke("HTTP_PATH_UNRESOLVED", {
      flow: binding.flow.name || "(unnamed)",
      method: trigger.method,
    });
  }
  if (!binding.flow.name || binding.flow.name.startsWith("flow_")) {
    throwOke("HTTP_FLOW_UNNAMED", {
      method: trigger.method,
      path: trigger.path,
    });
  }
}

/**
 * Register one HTTP binding: unique method+path, unique live exposure key.
 *
 * @param binding - HTTP binding
 * @param seenHttpRoutes - `METHOD path` keys
 * @param seenLiveExposures - `(signal, gates, match)` keys
 * @param smart - Router
 * @param compiled - Compiled route map
 * @param aot - AoT compile flag
 */
function registerHttpRoute(
  binding: Binding,
  seenHttpRoutes: Set<string>,
  seenLiveExposures: Map<string, string>,
  smart: { add(method: string, path: string, value: Binding): void },
  compiled: WeakMap<Binding, CompiledRoute>,
  aot: boolean,
): void {
  const trigger = binding.trigger;
  if (trigger.kind !== "http") return;
  const routeKey = `${trigger.method} ${trigger.path}`;
  if (seenHttpRoutes.has(routeKey)) {
    throwOke("HTTP_ROUTE_DUPLICATE", {
      method: trigger.method,
      path: trigger.path,
      flow: binding.flow.name || "(unnamed)",
    });
  }
  seenHttpRoutes.add(routeKey);
  if (trigger.liveSignal !== undefined) {
    const matchKey = binding.flow.liveCustomMatch
      ? `custom:${binding.flow.name}`
      : liveMatchKeyFromPath(trigger.path);
    const exposure = liveExposureKey(
      trigger.liveSignal.name,
      liveGatesKey(trigger.gates),
      matchKey,
    );
    if (seenLiveExposures.has(exposure)) {
      throwOke("LIVE_EXPOSURE_DUPLICATE", {
        signal: trigger.liveSignal.name,
        gates: liveGatesKey(trigger.gates) || "(none)",
        match: matchKey || "(firehose)",
      });
    }
    seenLiveExposures.set(exposure, binding.flow.name);
  }
  smart.add(trigger.method, trigger.path, binding);
  compiled.set(binding, compileHttpBinding(binding, aot));
}

/**
 * Register one MCP tool binding: unique tool name, indexed for dispatch lookup.
 *
 * Only gated exposures are indexed — bare `mcp.tool(name)` bindings remain
 * unlisted (deny-by-default) and are rejected at boot by gate posture audit.
 *
 * @param binding - MCP tool binding
 * @param seenMcpTools - Tool names already registered
 * @param mcpToolsByName - Tool name → binding index for dispatch
 */
function registerMcpTool(
  binding: Binding,
  seenMcpTools: Set<string>,
  mcpToolsByName: Map<string, Binding>,
): void {
  const trigger = binding.trigger;
  if (trigger.kind !== "mcp") return;
  if (seenMcpTools.has(trigger.name)) {
    throwOke("MCP_TOOL_DUPLICATE", {
      tool: trigger.name,
      flow: binding.flow.name || "(unnamed)",
    });
  }
  seenMcpTools.add(trigger.name);
  if (trigger.gates.length > 0) {
    mcpToolsByName.set(trigger.name, binding);
  }
}

/**
 * Fold `generated.ts` units into `$routes` and `flowsByName`.
 *
 * @param units - Drained {@link registerFlowUnits} bag
 * @param routes - Runtime `$routes`
 * @param registerFlow - App flow index
 */
function drainGeneratedUnits(
  units: Record<string, FlowUnitBag>,
  routes: RuntimeRouteMap,
  registerFlow: (flowDef: AnyFlowDef) => void,
): void {
  if (Object.keys(units).length === 0) return;
  const flows = accumulateAdoptArgs([units], routes);
  for (const flowDef of flows) {
    registerFlow(flowDef);
  }
}

/**
 * Create an application. Adopts bindings registered via {@link on}.
 * Drains {@link registerFlowUnits} into `$routes` unless `registry: "ignore"`.
 *
 * @param options - App name and router preset
 */
export function oke(
  options: OkeOptions & { readonly registry: "ignore" },
): OkeApp<Record<string, never>, Record<string, never>>;
export function oke(options: OkeOptions): OkeApp<{}, RoutesFromRegisteredUnits>;
export function oke(options: OkeOptions): OkeApp {
  const aot = options.aot !== false;
  const registry = options.registry ?? "consume";
  const adopted: Binding[] =
    registry === "ignore"
      ? [...(options.bindings ?? [])]
      : [...listBindings(), ...(options.bindings ?? [])];
  if (registry === "consume") resetBindings();

  // Same registry mode drains store.*, vault.secret, signal(), clock(),
  // gate.policy/scope/rate, channel.<medium>().template(), and
  // ai.model/prompt/embed/agent/mcpServer — module-evaluation registries
  // that mirror `on`'s trigger drain (`listBindings`/`resetBindings` above).
  // Explicit `options.stores` / `secrets` / `signals` / `clocks` /
  // `gate.policies` / `channel.templates` / `ai` are additive, never
  // silently ignored — deduped by reference so an explicitly-passed decl
  // that is also in the registry is not doubled.
  const registrySnapshot =
    registry === "ignore"
      ? {
          stores: [],
          secrets: [],
          requiredEnv: [],
          signals: [],
          clocks: [],
          gates: [],
          channelTemplates: [],
          aiModels: [],
          aiPrompts: [],
          aiEmbeds: [],
          aiAgents: [],
          aiMcpServers: [],
        }
      : {
          stores: storeRegistry.slice(),
          secrets: secretRegistry.slice(),
          requiredEnv: requiredEnvRegistry.slice(),
          signals: signalRegistry.slice(),
          clocks: clockRegistry.slice(),
          gates: gateRegistry.slice(),
          channelTemplates: channelTemplateRegistry.slice(),
          aiModels: aiModelRegistry.slice(),
          aiPrompts: aiPromptRegistry.slice(),
          aiEmbeds: aiEmbedRegistry.slice(),
          aiAgents: aiAgentRegistry.slice(),
          aiMcpServers: aiMcpServerRegistry.slice(),
        };
  if (registry === "consume") {
    storeRegistry.length = 0;
    secretRegistry.length = 0;
    requiredEnvRegistry.length = 0;
    signalRegistry.length = 0;
    clockRegistry.length = 0;
    gateRegistry.length = 0;
    channelTemplateRegistry.length = 0;
    aiModelRegistry.length = 0;
    aiPromptRegistry.length = 0;
    aiEmbedRegistry.length = 0;
    aiAgentRegistry.length = 0;
    aiMcpServerRegistry.length = 0;
  }
  const effectiveStores = mergeUnique(options.stores, registrySnapshot.stores);
  const effectiveSecrets = mergeUnique(options.secrets, registrySnapshot.secrets);
  const effectiveSignals = mergeUnique(options.signals, registrySnapshot.signals);
  const mergedClocks = mergeUnique(options.clocks, registrySnapshot.clocks);
  // Apply oke({ clock: { timezone } }) now; leave defaulted clocks intact when
  // unset so bindClock can still honor defineConfig({ clock: { timezone } }).
  const effectiveClocks = options.clock?.timezone
    ? applyClockTimezoneDefaults(mergedClocks, options.clock.timezone)
    : mergedClocks;
  const effectivePolicies = mergeUnique(options.gate?.policies, registrySnapshot.gates);
  /**
   * Fold registered `vault.env.required` names into the vault boot options so
   * boot reports missing env vars in the same gap list as missing secrets.
   *
   * @param base - Vault options from `oke({ vault })` / a boot override
   */
  const withRequiredEnv = (base: BootOptions["vault"]): BootOptions["vault"] => {
    const names = [...new Set([...(base?.requiredEnv ?? []), ...registrySnapshot.requiredEnv])];
    if (names.length === 0) return base;
    return { ...(base ?? {}), requiredEnv: names };
  };
  // Stay `undefined` (never a defined-but-empty object) when neither an
  // explicit `options.channel` nor a registered template exists — a defined
  // object here would flip `resolveElementNeeds`'s `channel` need to `true`
  // for every app, whether or not it uses channel at all.
  const effectiveChannel: BootOptions["channel"] =
    options.channel === undefined && registrySnapshot.channelTemplates.length === 0
      ? undefined
      : {
          ...(options.channel ?? {}),
          templates: mergeUnique(options.channel?.templates, registrySnapshot.channelTemplates),
        };
  // Same undefined-when-empty rule for AI — a bare `{}` would force the AI
  // runtime open even when the app never declared models / prompts.
  const effectiveAi = mergeAiOptions(options.ai, {
    models: registrySnapshot.aiModels,
    prompts: registrySnapshot.aiPrompts,
    embeds: registrySnapshot.aiEmbeds,
    agents: registrySnapshot.aiAgents,
    mcpServers: registrySnapshot.aiMcpServers,
  });

  // Resolve Gate bag early so auth HTTP Bindings join `adopted` + the router
  // before posture audit (same ensureBoot → doBoot path — never a side channel).
  const mergedGate: GateOptions | undefined =
    effectivePolicies.length > 0 ? { ...options.gate, policies: effectivePolicies } : options.gate;
  const gateConfig: ResolvedGateConfig = resolveGateConfig({
    gate: mergedGate,
    env: options.env,
  });

  /** Retained for test harness / boot merges (includes auto-drained decls). */
  const $options: OkeOptions = {
    ...options,
    ...(effectiveAi !== undefined ? { ai: effectiveAi } : {}),
    ...(effectiveChannel !== undefined ? { channel: effectiveChannel } : {}),
    ...(effectiveStores.length > 0 ? { stores: effectiveStores } : {}),
    ...(effectiveSecrets.length > 0 ? { secrets: effectiveSecrets } : {}),
    ...(effectiveSignals.length > 0 ? { signals: effectiveSignals } : {}),
    ...(effectiveClocks.length > 0 ? { clocks: effectiveClocks } : {}),
    ...(mergedGate !== undefined ? { gate: mergedGate } : {}),
  };

  const appHooks: HookMap = {};
  const unitHooks = new Map<string, HookMap>();
  const flowsByName = new Map<string, AnyFlowDef>();
  const compiled = new WeakMap<Binding, CompiledRoute>();
  const pluginRegistry = createPluginRegistry();
  const flushedPlugins = new WeakMap<AnyFlowDef, Set<PluginDef>>();
  /** Runtime route table — types accumulate on the returned {@link OkeApp}. */
  const routes: RuntimeRouteMap = {};

  let authMaterialization: AuthHttpMaterialization | undefined;
  let wiredAuth: WiredGateAuth | undefined;
  let authBinding: AppAuthBinding | undefined;
  if (gateConfig.auth) {
    const { wireGateAuth } = requirePackageModule<typeof import("./app-auth.ts")>(
      "kernel/app-auth",
      "app-auth",
    );
    wiredAuth = wireGateAuth({
      gateConfig: { ...gateConfig, auth: gateConfig.auth },
      now: options.fx?.now,
    });
    authMaterialization = wiredAuth.materialization;
    authBinding = wiredAuth.authBinding;
    if (authMaterialization) {
      adopted.push(...authMaterialization.bindings);
    }
    if (wiredAuth.authPlugin) {
      applyPlugin(pluginRegistry, wiredAuth.authPlugin, appPluginScope);
    }
  }

  const smart = createRouter<Binding>(options.router ?? "default");
  const seenHttpRoutes = new Set<string>();
  const seenLiveExposures = new Map<string, string>();
  const seenMcpTools = new Set<string>();
  const mcpToolsByName = new Map<string, Binding>();
  for (const b of adopted) {
    if (b.trigger.kind === "http") {
      assertHttpBindingReady(b);
      registerHttpRoute(b, seenHttpRoutes, seenLiveExposures, smart, compiled, aot);
    }
    if (b.trigger.kind === "mcp") {
      registerMcpTool(b, seenMcpTools, mcpToolsByName);
    }
  }
  // Defer SmartRouter selection until first match so `.plug()` can still
  // contribute auth-method Bindings before traffic (plan Phase 2).
  const router: Router<Binding> = smart;

  function adoptBinding(b: Binding): void {
    adopted.push(b);
    registerFlow(b.flow);
    if (b.trigger.kind === "http") {
      assertHttpBindingReady(b);
      registerHttpRoute(b, seenHttpRoutes, seenLiveExposures, smart, compiled, aot);
    }
    if (b.trigger.kind === "mcp") {
      registerMcpTool(b, seenMcpTools, mcpToolsByName);
    }
  }

  // Project-wide `store.live` default — drain deferred resource live mounts
  // now that the flag is known. Off flag: pending state is discarded and the
  // behavior is 100% today's explicit-only. On flag: every pending resource
  // whose table did not opt out with `store.schema.live(false)` adopts its
  // `GET <path>/live` SSE binding through the normal route path.
  drainPendingResourceLiveMounts(options.store?.live === true, adoptBinding);

  // Phase 1a: mirror tokens into Set-Cookie when gate.auth.cookies.enabled.
  if (gateConfig.auth?.cookies.enabled) {
    const cookieCfg = gateConfig.auth.cookies;
    const basePath = gateConfig.auth.basePath;
    const list = appHooks.afterHandle ?? (appHooks.afterHandle = []);
    list.push(async (ctx) => {
      const res = ctx.response;
      if (!(res instanceof Response) || !ctx.request) return;
      const url = new URL(ctx.request.url);
      const path = url.pathname;
      const underAuth = path === basePath || path.startsWith(`${basePath}/`);
      const isRevoke = path === `${basePath}/revoke` || path.endsWith("/revoke");
      const isIssue = underAuth && !isRevoke;
      if (!isIssue && !isRevoke) return;
      const { buildAuthSetCookies, clearAuthSetCookies } = await import("../auth/cookies.ts");
      const { ACCESS_TTL_MS, REFRESH_TTL_MS } = await import("../auth/sessions.ts");
      if (isRevoke || res.status >= 400) {
        if (isRevoke) {
          const headers = new Headers(res.headers);
          for (const c of clearAuthSetCookies(cookieCfg)) headers.append("Set-Cookie", c);
          ctx.response = new Response(res.body, { status: res.status, headers });
        }
        return;
      }
      try {
        const body = (await res.clone().json()) as {
          data?: { accessToken?: string; refreshToken?: string };
        };
        if (!body.data?.accessToken || !body.data?.refreshToken) return;
        const headers = new Headers(res.headers);
        const accessTtl = gateConfig.auth!.session.accessTtlMs ?? ACCESS_TTL_MS;
        const refreshTtl = gateConfig.auth!.session.refreshTtlMs ?? REFRESH_TTL_MS;
        for (const c of buildAuthSetCookies(
          cookieCfg,
          { accessToken: body.data.accessToken, refreshToken: body.data.refreshToken },
          { access: Math.floor(accessTtl / 1000), refresh: Math.floor(refreshTtl / 1000) },
        )) {
          headers.append("Set-Cookie", c);
        }
        ctx.response = new Response(res.body, { status: res.status, headers });
      } catch {
        /* ignore non-JSON */
      }
    });
  }

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

  if (registry !== "ignore") {
    const generatedUnits = consumeRegisteredFlowUnits();
    drainGeneratedUnits(generatedUnits, routes, registerFlow);
  }

  // --- boot (vault → store → signal → clock → channel → AI → runs → caps) ---
  let bootResult: BootResult | undefined;
  let bootPromise: Promise<BootResult> | undefined;
  let readyState: ReadyState = "booting";
  let bootEnv: BootOptions["env"] = options.env;
  // Fallback journal for pre-boot / `autoBoot: false` unit tests. A booted
  // app replaces this with the bound `drivers.journal` store (postgres etc.).
  // Constructed on first use so non-durable HTTP apps skip the alloc.
  let fallbackJournalStore: JournalStore | undefined;
  const processInstanceId = mintInstanceId();
  const fallbackJournalInstanceId = processInstanceId;
  const sleepingRuns = new Map<
    string,
    { readonly flow: AnyFlowDef; readonly input: unknown; readonly wakeAt: number }
  >();
  // Same-process mutual exclusion per runId. The lease coordinates across
  // processes, but same-holder renew cannot distinguish two overlapping
  // sessions inside one process (boot orphan scan vs. scheduler tick).
  const inflightRuns = new Set<string>();
  /** Store reads observed on open (unstamped) flows — next lookup uses these. */
  const learnedTier1Reads = new Map<string, readonly ResourceRef[]>();
  const EMPTY_CAPABILITIES: ReadonlyMap<string, CapabilityToken> = new Map();

  /** Active journal: the boot-bound store once available, else the fallback. */
  function activeJournal(): {
    readonly store: JournalStore;
    readonly instanceId: string;
    readonly leaseMs: number;
  } {
    const bound: JournalRuntime | undefined = bootResult?.journal;
    if (bound) {
      return { store: bound.store, instanceId: bound.instanceId, leaseMs: bound.leaseMs };
    }
    fallbackJournalStore ??= createMemoryJournalStore();
    return {
      store: fallbackJournalStore,
      instanceId: fallbackJournalInstanceId,
      leaseMs: JOURNAL_DEFAULT_LEASE_MS,
    };
  }

  async function handleCronFire(name: string): Promise<void> {
    const extras = gateConfig.auth?.tenant
      ? (loadAppTenant().w(0, name) as { readonly tenant: { readonly id: string } } | undefined)
      : undefined;
    await app.dispatchEvery(name, extras);
    // Named clocks (e.g. `clock("expire-stale", { every: "1h" })`) reconcile
    // to a store row whose effective interval may differ from the cron name.
    const row = await bootResult?.clock?.store.get(name);
    if (row?.effectiveEvery && row.effectiveEvery !== name) {
      await app.dispatchEvery(row.effectiveEvery, extras);
    }
  }

  async function handleSignalFire(
    name: string,
    payload: unknown,
    meta?: { readonly parentRunId?: string; readonly messageId?: string },
  ): Promise<void> {
    await app.dispatchSignal(name, payload, meta);
  }

  async function handleDurableResume(): Promise<void> {
    await app.resumeDurable();
  }

  /** Element runtimes handed to durable resumes (same bag as cron dispatch). */
  function durableResumeFx() {
    return {
      storeRuntime: bootResult?.store,
      signalRuntime: bootResult?.signal,
      vaultRuntime: bootResult?.vault,
      channelRuntime: bootResult?.channel,
      aiRuntime: bootResult?.ai,
    };
  }

  /**
   * Resume one persisted run under its lease. A lost lease race is the
   * coordination win — another live instance owns the run, so skip quietly.
   */
  /** Runs whose undeclared flow was already logged (sweep ticks must not spam). */
  const warnedOrphanRuns = new Set<string>();

  async function resumeDurableRun(
    runId: string,
    flowName: string,
    input: unknown,
    now: () => number,
  ): Promise<void> {
    // The lease only coordinates across processes — within one process,
    // overlapping callers (orphan scan vs. scheduler tick) would both pass
    // same-holder lease renewal and run two sessions for one runId.
    if (inflightRuns.has(runId)) return;
    inflightRuns.add(runId);
    try {
      const flowDef = flowsByName.get(flowName);
      if (!flowDef) {
        if (!warnedOrphanRuns.has(runId)) {
          warnedOrphanRuns.add(runId);
          console.warn(`oke: durable run "${runId}": undeclared flow "${flowName}" — skipped`);
        }
        return;
      }
      const { store, instanceId, leaseMs } = activeJournal();
      const existing = await store.get(runId);
      try {
        await loadDurable().runDurable({
          flow: flowDef,
          input,
          journalStore: store,
          runId,
          ...(hasJournalLease(store) ? { lease: { instanceId, leaseMs } } : {}),
          now,
          fx: {
            ...durableResumeFx(),
            ...(gateConfig.auth?.tenant ? (loadAppTenant().w(5, gateConfig.auth) as object) : {}),
            ...(existing?.tenant ? { tenant: { id: existing.tenant } } : {}),
          },
        });
      } catch (err) {
        if (isJournalLeaseBusy(err)) return;
        throw err;
      }
    } finally {
      inflightRuns.delete(runId);
    }
  }

  /** Boot-time orphan scan — `running`/`sleeping`/`compensating` with no live lease. */
  async function resumeOrphanedDurableRuns(): Promise<void> {
    const { store } = activeJournal();
    if (!hasJournalLease(store)) return;
    const now = () => bootResult?.clock?.now() ?? options.fx?.now?.() ?? Date.now();
    const orphans = await store.listOrphans(now());
    for (const orphan of orphans) {
      // Future sleeps are claimed by the scheduler tick when they come due —
      // the shared store is the schedule, no in-process seeding needed.
      if (orphan.status === "sleeping" && orphan.wakeAt !== undefined && orphan.wakeAt > now()) {
        continue;
      }
      await resumeDurableRun(orphan.id, orphan.flow, orphan.input, now);
    }
  }

  async function doBoot(overrides?: Partial<BootOptions>): Promise<BootResult> {
    const { bootApplication, resolveElementNeeds } = await import("./boot.ts");
    const { assertHttpGatePosture } = await import("../elements/gate/boot.ts");
    const { assertPluginNeeds, buildAvailableNeedTokens } = await import("./plugin-needs.ts");
    const dockerFlag =
      overrides?.docker === true ||
      (overrides?.docker !== false &&
        (options.docker === true || (options.docker !== false && process.env.OKE_DOCKER === "1")));
    // Mirror bootApplication: prod / compose-dev / else test (PGLite + memory).
    bootEnv =
      overrides?.env ??
      options.env ??
      (process.env.NODE_ENV === "production" ? "prod" : dockerFlag ? "dev" : "test");

    // Prod without a real secret fails even if construction minted a dev secret.
    if (gateConfig.auth?.secretMinted && bootEnv === "prod") {
      throw new Error(
        "gate.auth: secret is required in production (set gate.auth.secret or OKE_AUTH_SECRET)",
      );
    }

    const unguardedHttp = overrides?.unguardedHttp ?? gateConfig.unguardedHttp ?? "deny";
    // Auth bindings are in `adopted` — missing posture fails with GateBootError.
    assertHttpGatePosture(adopted, { unguardedHttp, env: bootEnv });

    const caps = pluginRegistry.capabilities();
    const pluginNames = new Set(Object.keys(caps));
    const authGates = authMaterialization?.authGates ?? [];
    const baseGates = overrides?.gates ?? gateConfig.policies ?? [];
    const elementNeeds = resolveElementNeeds({
      env: bootEnv,
      docker: overrides?.docker ?? options.docker,
      config: overrides?.config ?? options.config,
      elements: overrides?.elements ?? options.elements,
      secrets: overrides?.secrets ?? effectiveSecrets,
      vault: withRequiredEnv(overrides?.vault ?? options.vault),
      gates: [...baseGates, ...authGates],
      signals: overrides?.signals ?? effectiveSignals,
      clocks: overrides?.clocks ?? effectiveClocks,
      stores: overrides?.stores ?? effectiveStores,
      channel: overrides?.channel ?? effectiveChannel,
      ai: overrides?.ai ?? effectiveAi,
      runs: overrides?.runs ?? options.runs,
      runsBridge: overrides?.runsBridge ?? options.runsBridge,
      bindings: adopted,
      flows: [...flowsByName.values()],
    });
    const driverIds: string[] = [];
    for (const c of Object.values(caps)) {
      for (const d of c.declares) {
        if (d.startsWith("driver:")) driverIds.push(d.slice("driver:".length));
      }
    }
    const stores = overrides?.stores ?? effectiveStores;
    const available = buildAvailableNeedTokens({
      elements: {
        storeSql:
          elementNeeds.store ||
          stores.some((s) => s.facet === "sql") ||
          pluginRegistry.tableContributions().length > 0,
        storeKv:
          elementNeeds.store ||
          stores.some((s) => s.facet === "kv") ||
          gateConfig.auth?.secondaryStorage.enabled === true,
        storeFiles: elementNeeds.store || stores.some((s) => s.facet === "files"),
        storeIndex: elementNeeds.store || stores.some((s) => s.facet === "index"),
        signal: elementNeeds.signal,
        clock: elementNeeds.clock,
        gate: elementNeeds.gate || baseGates.length > 0 || authGates.length > 0,
        vault: elementNeeds.vault,
        channel: elementNeeds.channel,
        ai: elementNeeds.ai,
      },
      driverIds,
    });
    const pluginSecrets = pluginRegistry.vaultContributions();
    const pluginGates = pluginRegistry.gateContributions();
    const pluginSignals = pluginRegistry.signalContributions();
    const pluginClocks = pluginRegistry.clockContributions();
    const pluginChannelTemplates = pluginRegistry.channelTemplateContributions();
    const pluginChannelCatalogs = pluginRegistry.channelCatalogContributions();
    if (pluginSecrets.length > 0) available.add("vault");
    if (pluginGates.length > 0) available.add("gate");
    if (pluginSignals.length > 0) available.add("signal");
    if (pluginClocks.length > 0) available.add("clock");
    if (pluginChannelTemplates.length > 0 || pluginChannelCatalogs.length > 0) {
      available.add("channel");
    }
    // gate.auth (auto-absorbed auth plugin) satisfies `.needs("auth")`.
    if (gateConfig.auth) available.add("auth");
    assertPluginNeeds(caps, { pluginNames, available });

    const baseSecrets = overrides?.secrets ?? effectiveSecrets;
    const baseSignals = overrides?.signals ?? effectiveSignals;
    const baseClocks = overrides?.clocks ?? effectiveClocks;
    const baseChannel = overrides?.channel ?? effectiveChannel;
    const mergedCatalog = mergeTemplateCatalogs(baseChannel?.catalog, ...pluginChannelCatalogs);

    const merged: BootOptions = {
      env: bootEnv,
      docker: overrides?.docker ?? options.docker,
      config: overrides?.config ?? options.config,
      manifest: overrides?.manifest ?? options.manifest,
      rootDir: overrides?.rootDir ?? options.rootDir,
      elements: overrides?.elements ?? options.elements,
      secrets: [...baseSecrets, ...pluginSecrets],
      vault: withRequiredEnv(overrides?.vault ?? options.vault),
      gates: [...baseGates, ...authGates, ...pluginGates],
      unguardedHttp,
      signals: [...baseSignals, ...pluginSignals],
      clocks: [...baseClocks, ...pluginClocks],
      clock: overrides?.clock ?? options.clock,
      stores: overrides?.stores ?? effectiveStores,
      channel: {
        ...(baseChannel ?? {}),
        templates: [...(baseChannel?.templates ?? []), ...pluginChannelTemplates],
        ...(mergedCatalog ? { catalog: mergedCatalog } : {}),
        defaultLocale:
          baseChannel?.defaultLocale ??
          (overrides?.config ?? options.config)?.i18n?.default ??
          "en",
      },
      ai: overrides?.ai ?? effectiveAi,
      runs: overrides?.runs ?? options.runs,
      runsBridge: overrides?.runsBridge ?? options.runsBridge,
      now: overrides?.now ?? options.fx?.now,
      instanceId: overrides?.instanceId ?? processInstanceId,
      instanceStore: overrides?.instanceStore,
      instanceHeartbeatMs: overrides?.instanceHeartbeatMs,
      instanceLeaseMs: overrides?.instanceLeaseMs,
      startScheduler: overrides?.startScheduler ?? options.startScheduler,
      schedulerIntervalMs: overrides?.schedulerIntervalMs ?? options.schedulerIntervalMs,
      journalLeaseMs: overrides?.journalLeaseMs ?? options.journalLeaseMs,
      bindings: adopted,
      flows: [...flowsByName.values()],
      onCronFire: overrides?.onCronFire ?? handleCronFire,
      onSignal: overrides?.onSignal ?? handleSignalFire,
      onDurableResume: overrides?.onDurableResume ?? handleDurableResume,
      ...(gateConfig.auth?.tenantStore
        ? (loadAppTenant().w(1, gateConfig.auth.tenantStore) as object)
        : {}),
    };
    const result = await bootApplication(merged);
    bootResult = result;
    if (gateConfig.auth?.tenantStore && result.clock) {
      loadAppTenant().w(2, gateConfig.auth.tenantStore, result.clock.store, merged.clocks ?? []);
    }
    if (gateConfig.auth?.apiKeyStore && result.store) {
      const { bindHostApiKeySqlFromStore } = await import("../auth/api-key-sql.ts");
      await bindHostApiKeySqlFromStore(result.store, gateConfig.auth.apiKeyStore);
    }
    if (gateConfig.auth?.identities && result.store) {
      const { bindHostIdentitySqlFromStore } = await import("../auth/identity-sql.ts");
      await bindHostIdentitySqlFromStore(result.store, gateConfig.auth.identities);
    }
    // Realtime bridge — CDC sink + LiveQuery runtime + outbox poller when a
    // Postgres-capable primary SQL connection exists. No-op otherwise.
    if (result.store) {
      const { bindRealtimeBridge } = await import("./realtime-bind.ts");
      const primaryConn = await result.store.primarySql();
      if (primaryConn) {
        bindRealtimeBridge(primaryConn, (tableName, payload) =>
          app.dispatchCdc(tableName, {
            before: (payload.before ?? null) as Record<string, unknown> | null,
            after: (payload.after ?? null) as Record<string, unknown> | null,
          }),
        );
      }
    }
    // otp() provider / app mode capability — fail loud at boot, never silent downgrade.
    if (result.channel) {
      const { assertOtpPluginCapability } = await import("../auth/otp-capability.ts");
      for (const entry of pluginRegistry.installed) {
        if (entry.plugin.name === "otp") {
          assertOtpPluginCapability(entry.plugin.configSnapshot, result.channel.drivers);
        }
      }
    }
    // Boot-time orphan discovery: resume/schedule any `running` / `sleeping`
    // run left without a live lease by a crashed (or previous) instance.
    // Does not block boot return — readiness stays `orphan_scan` until done.
    if (result.journal && hasJournalLease(result.journal.store)) {
      readyState = "orphan_scan";
      void resumeOrphanedDurableRuns()
        .catch((err) => {
          console.error("oke: durable orphan scan failed", err);
        })
        .finally(() => {
          if (bootResult === result) readyState = "ready";
        });
    } else {
      readyState = "ready";
    }
    // Prefer the booted clock for access-token expiry checks.
    if (wiredAuth && authBinding) {
      const now = result.clock?.now.bind(result.clock) ?? authBinding.now;
      authBinding = wiredAuth.rebind(now);
    }
    return result;
  }

  /**
   * Boot lazily on first execute/fetch unless {@link OkeOptions.autoBoot} is
   * explicitly `false` (legacy pre-boot escape hatch for unit tests).
   * Default is on — security posture and element runtimes are not optional
   * for traffic-serving apps.
   */
  async function ensureBoot(): Promise<BootResult | undefined> {
    if (bootResult) return bootResult;
    if (options.autoBoot === false) return undefined;
    if (!bootPromise) {
      bootPromise = doBoot();
    }
    return bootPromise;
  }

  function isRunsRuntimeLike(value: OkeOptions["runs"]): value is RunsRuntime {
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
      /** Console invoke-as / trusted in-process callers only. */
      readonly trustedInvoke?: boolean;
      /** Console Operator invoke — skip gates. Requires {@link trustedInvoke}. */
      readonly bypassGates?: boolean;
      /** Console Call API — cleartext store PII. Requires {@link trustedInvoke}. */
      readonly revealPii?: boolean;
      /** Forced RLS bag (Console / Call API). Operator omit = no stamp. */
      readonly rls?: import("../drivers/pg-rls.ts").RlsIdentity;
      /** Frozen origin identity for {@link Fx.principal} across `fx.call`. */
      readonly originPrincipal?: FxPrincipal;
      /** Explicit locale override for {@link Fx.t} / channel sends. */
      readonly locale?: string;
      /** Parent WideEvent id when this execution was caused by another. */
      readonly parentId?: string;
      /** Explicit run / WideEvent id (defaults to a new UUID). */
      readonly runId?: string;
      /** Tenant identity for cron / `fx.call` (propagated, unlike auth). */
      readonly tenant?: { readonly id: string | null };
    },
  ): Promise<ExecuteResult> {
    registerFlow(flowDef);

    const i18nConfig = options.config?.i18n;
    const configuredLocales = i18nConfig?.locales ?? ["en"];
    const defaultLocale = i18nConfig?.default ?? "en";
    const acceptLanguage = extras?.request?.headers.get("accept-language") ?? undefined;
    const resolvedLocale = loadMessages().matchConfiguredLocale(
      extras?.locale ?? parseAcceptLanguage(acceptLanguage),
      configuredLocales,
      defaultLocale,
    );

    return runWithLocale({ locale: resolvedLocale, defaultLocale }, () => {
      const run = async (): Promise<ExecuteResult> => {
        // Ambient mutation id — the client's `X-Oke-Mutation-Id` header rides
        // onto every CDC event this write produces so optimistic clients can
        // dedupe their own writes (Realtime correctness contract).
        const mutationId = extras?.request?.headers.get(MUTATION_ID_HEADER)?.trim();
        if (mutationId !== undefined && mutationId.length > 0) {
          return withCdcMutationId(mutationId, () =>
            executeInLocale({
              flowDef,
              input,
              trigger,
              extras,
              resolvedLocale,
              defaultLocale,
            }),
          );
        }
        return executeInLocale({
          flowDef,
          input,
          trigger,
          extras,
          resolvedLocale,
          defaultLocale,
        });
      };
      const abort = extras?.request?.signal;
      return abort ? withAbortSignal(abort, run) : run();
    });
  }

  async function executeInLocale(args: {
    readonly flowDef: AnyFlowDef;
    readonly input: unknown;
    readonly trigger: Trigger;
    readonly extras?: {
      readonly request?: Request;
      readonly params?: Record<string, string>;
      readonly validated?: boolean;
      readonly auth?: ResolvedPrincipal | FxAuth;
      readonly operator?: FxOperator;
      readonly principal?: ResolvedPrincipal;
      readonly trustedInvoke?: boolean;
      readonly bypassGates?: boolean;
      readonly revealPii?: boolean;
      readonly rls?: import("../drivers/pg-rls.ts").RlsIdentity;
      readonly originPrincipal?: FxPrincipal;
      readonly locale?: string;
      readonly parentId?: string;
      readonly runId?: string;
      readonly tenant?: { readonly id: string | null };
    };
    readonly resolvedLocale: string;
    readonly defaultLocale: string;
  }): Promise<ExecuteResult> {
    const { flowDef, input, trigger, extras, resolvedLocale, defaultLocale } = args;
    const booted = await ensureBoot();
    const tenantEnabled = gateConfig.auth?.tenant !== undefined;
    const flowTenantScoped = flowDef.tenantScoped ?? tenantEnabled;

    const unitBag = flowDef.unit !== undefined ? unitHooks.get(flowDef.unit) : undefined;
    // app (hooks + plugs) → unit (hooks + plugs) → flow (hooks + plugs)
    const composedHooks = mergeHooks(
      mergeHooks(appHooks, pluginRegistry.hooksAt("app", flowDef.unit, flowDef.name), undefined),
      mergeHooks(unitBag, pluginRegistry.hooksAt("unit", flowDef.unit, flowDef.name), undefined),
      mergeHooks(
        flowDef.hooks as HookMap,
        pluginRegistry.hooksAt("flow", flowDef.unit, flowDef.name),
        undefined,
      ),
    );

    const decorations = pluginRegistry.decorationsFor(flowDef.unit, flowDef.name);

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
    const startedHr = performance.now();
    const telemetry = createRunTelemetry();
    const inboundId =
      extras?.request?.headers.get("x-request-id")?.trim() ||
      extras?.request?.headers.get("x-correlation-id")?.trim() ||
      undefined;
    const runId =
      extras?.runId ??
      (inboundId && inboundId.length > 0 ? inboundId : undefined) ??
      crypto.randomUUID();
    const parentId = extras?.parentId;

    // Element pipeline wiring only kicks in once booted — `autoBoot: false`
    // keeps intentional pre-boot unit tests ungated (no elements either).
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
          apiKeyId: options.fx?.auth?.apiKeyId,
        },
        operator: { id: options.fx?.operator?.id ?? null },
        tenant: { id: extras?.tenant?.id ?? options.fx?.tenant?.id ?? null },
      };

      // Principal injection: test harness (`env: "test"`) OR console-trusted
      // invoke-as (`extras.trustedInvoke`). Never from public HTTP fetch.
      const testMode = bootEnv === "test";
      const allowInjectedPrincipals = testMode || extras?.trustedInvoke === true;
      if (allowInjectedPrincipals) {
        applyPrincipal(principals, extras?.auth as ResolvedPrincipal | undefined);
        applyPrincipal(principals, extras?.principal);
        if (extras?.operator) principals.operator.id = extras.operator.id;
      }

      const binding = authBinding;
      const cookieOpts = gateConfig.auth?.cookies;
      const cookieToken = wiredAuth?.tokenFromCookieHeader;
      const apiKeyStore = gateConfig.auth?.apiKeyStore;
      const tenantEnabled = gateConfig.auth?.tenant !== undefined;
      const flowTenantScoped = flowDef.tenantScoped ?? tenantEnabled;
      const elementHooks = createElementPipelineHooks({
        gates: booted.gate,
        principals,
        telemetry,
        allowTestPrincipals: allowInjectedPrincipals,
        ...(extras?.bypassGates === true && extras.trustedInvoke === true
          ? { bypassGates: true }
          : {}),
        verifyBearer:
          binding && wiredAuth
            ? (token, request) =>
                wiredAuth.verifyBearerOrApiKey(binding, token, apiKeyStore, request)
            : undefined,
        // Phase 1a: opt-in cookie → Bearer when Authorization is absent.
        resolveToken:
          binding && cookieOpts?.enabled && cookieToken
            ? (request) => {
                const header = request.headers.get("authorization");
                if (header?.startsWith("Bearer ")) {
                  return header.slice("Bearer ".length).trim() || undefined;
                }
                return cookieToken(request.headers.get("cookie"), cookieOpts);
              }
            : undefined,
        ...(gateConfig.auth?.tenant && gateConfig.auth.tenantStore
          ? (loadAppTenant().w(
              3,
              gateConfig.auth.tenant,
              gateConfig.auth.tenantStore,
              flowTenantScoped,
              flowDef.plane,
            ) as object)
          : {}),
      });

      // Element hooks run first in the app-level onAuth/beforeHandle chain —
      // principal resolution and gate checks precede user-registered hooks.
      hooks = mergeHooks(
        {
          onAuth: [
            elementHooks.onAuth,
            async () => {
              if (journalSession && principals?.tenant.id) {
                await journalSession.stampTenant(principals.tenant.id);
              }
            },
          ],
          beforeHandle: [elementHooks.beforeHandle],
        },
        composedHooks,
        undefined,
      );

      capability = booted.capabilities.get(flowDef.name);

      if (flowDef.durable) {
        const { store, instanceId, leaseMs } = activeJournal();
        const journal = createJournal({
          store,
          now,
          id: () => runId,
          // Hold the run lease for the request's lifetime — a crash mid-run
          // leaves an expired lease another instance can reclaim and resume.
          ...(hasJournalLease(store) ? { lease: { instanceId, leaseMs } } : {}),
        });
        journalSession = await journal.start(flowDef.name, input);
        inflightRuns.add(journalSession.runId);
      }
    }

    const effects = flowDef.effects ?? capability?.declared;
    const { fx, ledger } = loadFx().createFxContext({
      ...options.fx,
      flow: flowDef.name,
      effects,
      runTelemetry: telemetry,
      runId,
      lastEventId: extras?.request?.headers.get("last-event-id") || undefined,
      now,
      i18n: {
        locale: resolvedLocale,
        defaultLocale,
        catalogs: loadMessages().getMessageCatalogs(),
        ...options.fx?.i18n,
      },
      ...(principals
        ? {
            auth: principals.auth,
            operator: principals.operator,
            tenant: principals.tenant,
          }
        : extras?.tenant
          ? { tenant: { id: extras.tenant.id } }
          : {}),
      apiKeyStore: gateConfig.auth?.apiKeyStore,
      sessions: authBinding?.sessions,
      manifest: options.manifest,
      ...(tenantEnabled || extras?.tenant
        ? (loadAppTenant().w(4, {
            enabled: tenantEnabled,
            store: gateConfig.auth?.tenantStore,
            scoped: flowTenantScoped,
            plane: flowDef.plane,
            tenant: principals?.tenant ?? (extras?.tenant ? { id: extras.tenant.id } : undefined),
            bind: authBinding,
          }) as object)
        : {}),
      ...(extras?.originPrincipal ? { principal: extras.originPrincipal } : {}),
      ...(extras?.trustedInvoke === true && extras.revealPii === true ? { revealPii: true } : {}),
      rlsGateNames: gateNamesOf(trigger),
      rlsBypass: extras?.bypassGates === true || flowDef.plane === "operator",
      ...(extras?.rls ? { rls: extras.rls } : {}),
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
      runsRuntime: booted?.runs ?? (isRunsRuntimeLike(options.runs) ? options.runs : undefined),
      ...(journalSession ? { journal: journalSession, durable: true } : {}),
      callHandler: async (name, callInput) => {
        const target = flowsByName.get(name);
        if (!target) {
          return undefined;
        }
        const inner = await execute(
          target,
          callInput,
          { kind: "internal" } satisfies InternalTrigger,
          {
            originPrincipal: loadFx().freezePrincipal(fx.principal),
            locale: resolvedLocale,
            parentId: runId,
            ...(tenantEnabled ? { tenant: { id: fx.tenant.id } } : {}),
            ...(extras?.trustedInvoke === true && extras.revealPii === true
              ? { trustedInvoke: true, revealPii: true }
              : {}),
          },
        );
        if (inner.failure) return inner.failure;
        return inner.output;
      },
    });

    const alreadyValidated = extras?.validated === true;

    const result = await runPipeline(
      ctx,
      fx,
      hooks,
      async () => {
        try {
          const invoke = async (input: unknown) => {
            const storeRt = booted?.store;
            const cache = storeRt ? loadStoreCache() : undefined;
            const declaredForCache: Effects | undefined = capability?.open
              ? flowDef.effects
              : (effects ?? {});
            const cacheEffects = cache
              ? cache.resolveCacheEffects(declaredForCache, learnedTier1Reads.get(flowDef.name))
              : undefined;
            // Revealed PII must not hit a prior masked entry or land in cache.
            const reveal = extras?.trustedInvoke === true && extras.revealPii === true;
            const cacheOk =
              cache !== undefined &&
              storeRt !== undefined &&
              cacheEffects !== undefined &&
              !reveal &&
              cache.autoCacheEligible({
                cache: flowDef.cache,
                durable: flowDef.durable,
                effects: cacheEffects,
              });
            const dims =
              cacheOk && cache && cacheEffects
                ? cache.tier1DimsByResource(cacheEffects, flowDef.name, input, fx.auth.userId)
                : undefined;
            if (cacheOk && cache && dims && storeRt) {
              const keys = cache.tier1KeysForReads(cacheEffects, dims);
              const probes: { key: string; timestamp: number; duration: number }[] = [];
              const cached = cache.tier1Lookup((key) => {
                const timestamp = now();
                const t0 = performance.now();
                const value = storeRt.cache.get(key);
                probes.push({
                  key,
                  timestamp,
                  duration: resolveDurationMs(now() - timestamp, performance.now() - t0),
                });
                return value;
              }, keys);
              if (cached !== undefined) {
                for (const probe of probes) {
                  recordObservedEffect(ledger, "read", probe.key, probe.timestamp, probe.duration);
                }
                telemetry.cacheHits += 1;
                return cached;
              }
              telemetry.cacheMisses += 1;
            }
            const run = () => {
              // Flow-level retry re-enters `do` on the same journal session —
              // rewind so completed steps/effects replay instead of re-executing.
              journalSession?.rewind();
              return flowDef.do(input as never, fx);
            };
            const output = await (flowDef.retry ? fxRetry(run, flowDef.retry) : run());
            if (!isFlowFailure(output) && cache && storeRt && cacheEffects) {
              const ledgerFx = cache.effectsFromLedger(ledger.entries);
              const writeEffects: Effects = {
                writes: [
                  ...new Set([...(cacheEffects.writes ?? []), ...(ledgerFx.writes ?? [])]),
                ].filter(cache.isStoreResourceRef),
              };
              if ((writeEffects.writes?.length ?? 0) > 0) {
                storeRt.onWriteEffects(writeEffects);
              }
              const mergedReads = [
                ...new Set([...(cacheEffects.reads ?? []), ...(ledgerFx.reads ?? [])]),
              ].filter(cache.isStoreResourceRef);
              if (mergedReads.length > 0) {
                learnedTier1Reads.set(flowDef.name, mergedReads);
              }
              const putEffects: Effects = {
                reads: mergedReads,
                ...(ledgerFx.writes ? { writes: ledgerFx.writes } : {}),
                ...(ledgerFx.asks ? { asks: ledgerFx.asks } : {}),
              };
              const storeAfter =
                !reveal &&
                cache.autoCacheEligible({
                  cache: flowDef.cache,
                  durable: flowDef.durable,
                  effects: putEffects,
                });
              if (storeAfter && output !== undefined && !loadFx().isJsonStreamResult(output)) {
                const ttlMs =
                  typeof flowDef.cache === "string" ? cache.parseTtlMs(flowDef.cache) : undefined;
                storeRt.putTier1(
                  putEffects,
                  output,
                  cache.tier1DimsByResource(putEffects, flowDef.name, input, fx.auth.userId),
                  ttlMs,
                );
                if (!cacheOk) telemetry.cacheMisses += 1;
              }
            }
            return output;
          };
          if (!alreadyValidated) {
            const parsed = await validate(flowDef.in, ctx.input);
            if (!parsed.ok) return parsed.failure;
            ctx.input = parsed.value;
            return await invoke(parsed.value);
          }
          return await invoke(ctx.input);
        } catch (err) {
          if (isFlowFailure(err)) return err;
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
      },
      // HTTP flows serialize before `onResponse` so the last stage can see
      // and replace the final response (plugin header/middleware surfaces).
      trigger.kind === "http" ? encodeExecuteResult : undefined,
    ).catch((err: unknown) => {
      // Park suspensions are already absorbed above; a real pipeline failure
      // still leaves the run lease to expire for cross-process reclaim, but
      // must not pin the runId in this process's in-flight guard forever.
      if (journalSession) inflightRuns.delete(journalSession.runId);
      throw err;
    });

    const endedAt = now();
    const durationMs = resolveDurationMs(endedAt - startedAt, performance.now() - startedHr);
    const streamOut = loadFx().isJsonStreamResult(result.output) ? result.output : undefined;

    const finalizeRun = async (): Promise<void> => {
      // Stream rows land in Traces only after close. Measure wall time then
      // so duration / waterfall cover the open stream, not just TTFB.
      const recordEndedAt = streamOut ? now() : endedAt;
      const recordDurationMs = streamOut
        ? resolveDurationMs(recordEndedAt - startedAt, performance.now() - startedHr)
        : durationMs;
      if (journalSession) {
        inflightRuns.delete(journalSession.runId);
        const sleeping = ctx.state.sleeping as
          | { readonly wakeAt: number; readonly label: string; readonly runId: string }
          | undefined;
        // Lease-capable stores make the shared row the wake schedule; the
        // in-process map is only for custom stores without the lease surface.
        if (sleeping && !hasJournalLease(activeJournal().store)) {
          sleepingRuns.set(sleeping.runId, {
            flow: flowDef,
            input: ctx.input,
            wakeAt: sleeping.wakeAt,
          });
        } else if (!sleeping && isTerminalFailure(result)) {
          const terminalErr = result.failure ?? result.ctx.error;
          await runCompensationPhase({
            flow: flowDef,
            input: ctx.input,
            session: journalSession,
            fx,
            error: terminalErr,
          });
        } else if (!sleeping) {
          await journalSession.commit("completed", {
            output: streamOut ? { streamed: true } : result.output,
          });
        }
      }

      const runsRuntime =
        booted?.runs ?? (isRunsRuntimeLike(options.runs) ? options.runs : undefined);
      if (runsRuntime) {
        const archiveCleartext = archiveFromInput(ctx.input, options.archiveInputFields);
        const replayInput = redactArchivedFields(ctx.input, options.archiveInputFields);
        const recordFailure =
          result.failure ??
          (isTerminalFailure(result) ? failureFromUnknown(result.ctx.error) : undefined);
        await runsRuntime.record(
          {
            flow: flowDef,
            trigger,
            fx,
            ledger,
            telemetry,
            startedAt,
            endedAt: recordEndedAt,
            durationMs: recordDurationMs,
            failure: recordFailure,
            id: runId,
            input: replayInput,
            ...(result.output !== undefined && !recordFailure
              ? { output: streamOut ? { streamed: true } : result.output }
              : {}),
            ...(parentId !== undefined ? { parentId } : {}),
          },
          archiveCleartext,
        );
      }
    };

    if (
      streamOut &&
      !isTerminalFailure(result) &&
      result.response?.headers.get("content-type")?.includes("text/event-stream")
    ) {
      streamOut.finalize = finalizeRun;
    } else {
      await finalizeRun();
    }

    return {
      output: result.output,
      failure: result.failure,
      response: result.response,
      ctx: result.ctx,
      fx,
      cache: cacheDimensionOf(telemetry),
      durationMs,
      runId,
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
    get readyState() {
      return readyState;
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
        ...(bootResult.journal ? { journal: bootResult.journal } : {}),
        ...(bootResult.instances ? { instances: bootResult.instances } : {}),
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
      // Realtime bridge down before connections close.
      {
        const { unbindRealtimeBridge } = await import("./realtime-bind.ts");
        unbindRealtimeBridge();
      }
      // Proactive lease release so survivors need not wait for TTL reclaim.
      await releaseInstanceLeases({
        bootResult: {
          clock: bootResult.clock,
          journal: bootResult.journal,
          instances: bootResult.instances,
        },
        stop: async () => {},
      });
      await bootResult.close();
      bootResult = undefined;
      bootPromise = undefined;
      readyState = "booting";
    },
    get authBinding() {
      return authBinding;
    },
    apiKeys: gateConfig.auth?.apiKeyStore,
    /** Shared identity store when `gate.auth` is enabled. */
    identities: gateConfig.auth?.identities,
    async resumeDurable(now) {
      const t = now ?? bootResult?.clock?.now() ?? options.fx?.now?.() ?? Date.now();
      const { store, instanceId, leaseMs } = activeJournal();
      if (hasJournalLease(store)) {
        // Shared store is the wake schedule — claim due sleeps across all
        // instances (SKIP LOCKED; exactly one claimant wins a raced claim).
        for (;;) {
          const due = await store.claimDueSleep(instanceId, t, leaseMs);
          if (!due) break;
          sleepingRuns.delete(due.id);
          await resumeDurableRun(due.id, due.flow, due.input, () => t);
        }
        // Crash sweep: the boot orphan scan is once-only, so each tick also
        // reclaims `running` runs whose holder's lease has expired (same
        // takeover physics as Clock: lease expiry + next tick).
        for (const orphan of await store.listOrphans(t)) {
          if (orphan.status !== "running") continue;
          await resumeDurableRun(orphan.id, orphan.flow, orphan.input, () => t);
        }
        return;
      }
      // Custom store without the lease surface — in-process sleepers only.
      for (const [runId, sleeper] of [...sleepingRuns.entries()]) {
        if (t < sleeper.wakeAt) continue;
        sleepingRuns.delete(runId);
        const result = await loadDurable().runDurable({
          flow: sleeper.flow,
          input: sleeper.input,
          journalStore: store,
          runId,
          now: () => t,
          fx: durableResumeFx(),
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
      const before = new Set(pluginRegistry.bindingContributions().map((b) => b.flow.name));
      applyPlugin(pluginRegistry, pluginDef, appPluginScope);
      for (const b of pluginRegistry.bindingContributions()) {
        if (before.has(b.flow.name)) continue;
        adoptBinding(b);
      }
      // Decorations accumulate on the interface; runtime object is unchanged.
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
      return flowsByName.get(loadFx().resolveName(ref as NamedRef));
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
      const started = performance.now();
      let flowLabel: string | undefined;
      let runLabel: string | undefined;
      let cacheLabel: "hit" | "miss" | "none" | undefined;
      const url = new URL(request.url);
      const method = request.method.toUpperCase();

      const respond = async (response: Response): Promise<Response> => {
        if (method === "QUERY" || response.headers.get("allow")?.includes("QUERY")) {
          response.headers.set("accept-query", '"application/json"');
        }
        if (shouldLogDevRequests()) {
          logDevRequest({
            surface: currentDevSurface(),
            method,
            path: url.pathname,
            flow: flowLabel,
            runId: runLabel,
            status: response.status,
            ms: Math.round(performance.now() - started),
            detail: await failureDetailFromResponse(response),
          });
        }
        return asBrowserJsonCodeBlock(
          request,
          response,
          options.name,
          httpNavGroups(adopted, request),
          performance.now() - started,
          cacheLabel ?? "none",
        );
      };

      // Kernel readiness — distinct from app-authored GET /health (liveness).
      if (method === "GET" && url.pathname === "/_/ready") {
        if (readyState === "ready") {
          return respond(
            new Response(JSON.stringify({ ready: true }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }
        return respond(
          new Response(JSON.stringify({ ready: false, reason: readyState }), {
            status: 503,
            headers: { "content-type": "application/json" },
          }),
        );
      }

      if (method === "GET" && url.pathname === "/_oke/client.json") {
        return respond(
          new Response(JSON.stringify({ routes }), {
            headers: { "content-type": "application/json" },
          }),
        );
      }

      if (method === "POST" && url.pathname.startsWith("/_oke/")) {
        const rest = url.pathname.slice("/_oke/".length);
        const parts = rest.split("/").filter((p) => p.length > 0);
        if (parts.length >= 2) {
          const [unit, ...flowParts] = parts;
          const flowName = flowParts.join("/");
          const target = flowsByName.get(`${unit}.${flowName}`) ?? flowsByName.get(flowName);
          if (!target) {
            return respond(new Response("Not Found", { status: 404 }));
          }
          flowLabel = target.name;
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
          runLabel = internalResult.runId;
          cacheLabel = internalResult.cache;
          return respond(await encodeExecuteResult(internalResult));
        }
      }

      const matched = router.match(method, url.pathname);
      if (!matched) {
        // Plugin edge handlers answer requests no flow owns (e.g. CORS
        // preflight for a path bound to another method) — first Response wins.
        for (const handle of pluginRegistry.edgeHandlers()) {
          const edgeResponse = await handle(request, { method, path: url.pathname });
          if (edgeResponse !== undefined) return respond(edgeResponse);
        }
        const allowed = router.allowedMethods(url.pathname);
        if (allowed.length > 0) {
          return respond(
            new Response("Method Not Allowed", {
              status: 405,
              headers: { allow: formatAllowHeader(allowed) },
            }),
          );
        }
        return respond(new Response("Not Found", { status: 404 }));
      }
      const { value: binding, params } = matched;
      flowLabel = binding.flow.name;

      if (method === "QUERY") {
        const ct = request.headers.get("content-type");
        if (!ct) {
          return respond(encodeFailure(fail("InvalidQuery", { reason: "missing_content_type" })));
        }
        if ((ct.split(";")[0] ?? "").trim().toLowerCase() !== "application/json") {
          return respond(
            Response.json(
              { data: null, error: fail("UnsupportedMediaType", { contentType: ct }).error },
              { status: 415 },
            ),
          );
        }
        let text: string;
        try {
          text = await request.text();
          if (text.length === 0) throw 0;
          JSON.parse(text);
        } catch {
          return respond(encodeFailure(fail("InvalidQuery", { reason: "inconsistent_content" })));
        }
        request = new Request(request, { method: "QUERY", body: text });
      }

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
          return respond(encodeFailure(parsed.failure));
        }
        input = parsed.input;
        validated = true;
      } else {
        // Non-compiled path (should not happen for HTTP bindings)
        input = undefined;
      }

      const result = await execute(binding.flow, input, binding.trigger, {
        request,
        params,
        validated,
      });
      runLabel = result.runId;
      cacheLabel = result.cache;

      return respond(await encodeExecuteResult(result));
    },
    async dispatchSignal(signal, payload, meta) {
      const name = loadFx().resolveName(signal);
      const results: ExecuteResult[] = [];
      for (const b of adopted) {
        if (b.trigger.kind === "signal" && b.trigger.name === name) {
          results.push(
            await execute(b.flow, payload, b.trigger as SignalAsTrigger, {
              ...(meta?.parentRunId !== undefined ? { parentId: meta.parentRunId } : {}),
            }),
          );
        }
      }
      return results;
    },
    async dispatchEvery(interval, extras) {
      const results: ExecuteResult[] = [];
      for (const b of adopted) {
        if (
          (b.trigger.kind === "clock" && b.trigger.name === interval) ||
          (b.trigger.kind === "every" && b.trigger.interval === interval)
        ) {
          results.push(await execute(b.flow, undefined, b.trigger, extras));
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
        : flowsByName.get(loadFx().resolveName(ref as NamedRef));
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
    resolveMcpTool(name) {
      return mcpToolsByName.get(name)?.flow;
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

/** True when the pipeline ended in a terminal failure (not sleep park). */
function isTerminalFailure(result: PipelineResult): boolean {
  if (result.failure) return true;
  return result.ctx.error !== undefined && !isJournalSuspend(result.ctx.error);
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

/**
 * Clone input with archived personal fields replaced by shred markers so the
 * replay snapshot never retains cleartext for those keys.
 *
 * @param input - Validated flow input
 * @param fields - Property names that go to {@link archiveFromInput}
 */
function redactArchivedFields(input: unknown, fields: readonly string[] | undefined): unknown {
  if (input === undefined) return undefined;
  if (!fields || fields.length === 0) return input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const obj = { ...(input as Record<string, unknown>) };
  for (const name of fields) {
    if (typeof obj[name] === "string" && (obj[name] as string).length > 0) {
      obj[name] = "[archived]";
    }
  }
  return obj;
}

/**
 * Deep-merge channel template catalogs (later parts win per locale).
 *
 * @param parts - Catalog fragments (undefined skipped)
 */
function mergeTemplateCatalogs(
  ...parts: readonly (TemplateCatalog | undefined)[]
): TemplateCatalog | undefined {
  const out: Record<
    string,
    Record<string, { readonly subject?: string; readonly text?: string; readonly html?: string }>
  > = {};
  let any = false;
  for (const part of parts) {
    if (!part) continue;
    any = true;
    for (const [template, locales] of Object.entries(part)) {
      out[template] = { ...(out[template] ?? {}), ...locales };
    }
  }
  return any ? out : undefined;
}

/** @internal expose smart router type for tests */
export type { HttpTrigger, SmartRouter };
