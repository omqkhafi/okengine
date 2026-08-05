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
// when an app actually boots (AGENTS.md / unified-theory budget: cold start < 75 ms).
import type { BootOptions, BootResult, ElementRuntimes } from "./boot.ts";
import type { CapabilityToken } from "./capability.ts";
import { createAppAuthBinding, verifyBearerToken, type AppAuthBinding } from "./auth-resolve.ts";
import { createAuthHttpBindings, type AuthHttpMaterialization } from "../auth/bindings.ts";
import { auth as authPlugin } from "../auth/plugin.ts";
import { tokenFromCookieHeader } from "../auth/cookies.ts";
import { setActiveGateAuthContext } from "../auth/method-context.ts";
import {
  resolveGateConfig,
  type GateOptions,
  type ResolvedGateConfig,
} from "../elements/gate/config.ts";
import type { TemplateCatalog } from "../elements/channel/runtime.ts";
import { parseAcceptLanguage } from "../elements/channel/locale.ts";
import { runWithLocale } from "../i18n/locale-context.ts";
import { getMessageCatalogs, matchConfiguredLocale } from "../i18n/messages.ts";
import { runDurable } from "../elements/clock/durable.ts";
import { isFlow, type AnyFlowDef } from "./flow.ts";
import { fxRetry } from "./concurrency.ts";
import {
  createFxContext,
  freezePrincipal,
  resolveName,
  type CreateFxOptions,
  type Fx,
  type FxAuth,
  type FxOperator,
  type FxPrincipal,
  type NamedRef,
} from "./fx.ts";
import {
  currentDevSurface,
  failureDetailFromResponse,
  logDevRequest,
  shouldLogDevRequests,
} from "../runtime/dev-request-log.ts";
import { fail, type FlowFailure } from "./errors.ts";
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
import type { JournalRuntime } from "./boot-bind/journal.ts";
import { listBindings, resetBindings, type Binding } from "./on.ts";
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
import { createPluginRegistry, type PluginRegistry } from "./registry.ts";
import { createRouter, type Router, type RouterPreset, type SmartRouter } from "./router.ts";
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
   * Personal fields to archive (crypto-shred) from the validated input.
   * Keys are input property names; values become ciphertext under the
   * subject key.
   */
  readonly archiveInputFields?: readonly string[];
  /** Active environment for {@link OkeApp.boot} (defaults to `local`). */
  readonly env?: BootOptions["env"];
  /**
   * Docker mode (`oke dev -d` / `OKE_DOCKER=1`) — force the `docker`
   * driver profile at boot.
   */
  readonly docker?: BootOptions["docker"];
  /** Optional `oke.config.ts` document consumed at boot. */
  readonly config?: BootOptions["config"];
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
  /** Store facet declarations to register. */
  readonly stores?: BootOptions["stores"];
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
      /** Parent WideEvent id when this execution was caused by another. */
      readonly parentId?: string;
      /** Explicit run / WideEvent id (defaults to a new UUID). */
      readonly runId?: string;
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
   */
  dispatchEvery(interval: string): Promise<ExecuteResult[]>;
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
  const registry = options.registry ?? "consume";
  const adopted: Binding[] =
    registry === "ignore"
      ? [...(options.bindings ?? [])]
      : [...listBindings(), ...(options.bindings ?? [])];
  if (registry === "consume") resetBindings();

  // Resolve Gate bag early so auth HTTP Bindings join `adopted` + the router
  // before posture audit (same ensureBoot → doBoot path — never a side channel).
  const gateConfig: ResolvedGateConfig = resolveGateConfig({
    gate: options.gate,
    env: options.env,
  });
  let authMaterialization: AuthHttpMaterialization | undefined;
  if (gateConfig.auth?.http) {
    authMaterialization = createAuthHttpBindings(gateConfig.auth, {
      rateLimitEnabled: gateConfig.rateLimitEnabled,
      sessions: gateConfig.auth.sessions,
    });
    adopted.push(...authMaterialization.bindings);
  }

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

  // Absorb auth() tables into gate.auth — `.needs("auth")` sees plugin name.
  if (gateConfig.auth) {
    applyPlugin(
      pluginRegistry,
      authPlugin({
        secret: gateConfig.auth.secret,
        accessTtlMs: gateConfig.auth.session.accessTtlMs,
        refreshTtlMs: gateConfig.auth.session.refreshTtlMs,
        session: {
          accessTtlMs: gateConfig.auth.session.accessTtlMs,
          refreshTtlMs: gateConfig.auth.session.refreshTtlMs,
          idleTtlMs: gateConfig.auth.session.idleTtlMs,
          absoluteTtlMs: gateConfig.auth.session.absoluteTtlMs,
          singleSessionPerUser: gateConfig.auth.session.singleSessionPerUser,
        },
        password: gateConfig.auth.password,
        passwordPolicy: gateConfig.auth.passwordPolicy,
        breachCheck: gateConfig.auth.breachCheck,
      }),
      appPluginScope,
    );
  }

  const smart = createRouter<Binding>(options.router ?? "default");
  for (const b of adopted) {
    if (b.trigger.kind === "http") {
      smart.add(b.trigger.method, b.trigger.path, b);
      compiled.set(b, compileHttpBinding(b, aot));
    }
  }
  // Defer SmartRouter selection until first match so `.plug()` can still
  // contribute auth-method Bindings before traffic (plan Phase 2).
  const router: Router<Binding> = smart;

  function adoptBinding(b: Binding): void {
    adopted.push(b);
    registerFlow(b.flow);
    if (b.trigger.kind === "http") {
      smart.add(b.trigger.method, b.trigger.path, b);
      compiled.set(b, compileHttpBinding(b, aot));
    }
  }

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

  // --- boot (vault → store → signal → clock → channel → AI → runs → caps) ---
  let bootResult: BootResult | undefined;
  let bootPromise: Promise<BootResult> | undefined;
  let readyState: ReadyState = "booting";
  let bootEnv: BootOptions["env"] = options.env ?? "local";
  let authBinding: AppAuthBinding | undefined =
    gateConfig.auth !== undefined
      ? createAppAuthBinding({
          secret: gateConfig.auth.secret,
          sessions: authMaterialization?.ctx.sessions ?? gateConfig.auth.sessions,
          now: gateConfig.auth.now ?? options.fx?.now,
        })
      : undefined;
  if (authBinding) {
    setActiveGateAuthContext({
      secret: authBinding.secret,
      sessions: authBinding.sessions,
      now: authBinding.now,
      passwordPolicy: gateConfig.auth?.passwordPolicy,
      password: gateConfig.auth?.password,
      breachCheck: gateConfig.auth?.breachCheck,
    });
  } else {
    setActiveGateAuthContext(undefined);
  }
  // Fallback journal for pre-boot / `autoBoot: false` unit tests. A booted
  // app replaces this with the bound `drivers.journal` store (postgres etc.).
  const fallbackJournalStore = createMemoryJournalStore();
  const fallbackJournalInstanceId = `app-${crypto.randomUUID()}`;
  const sleepingRuns = new Map<
    string,
    { readonly flow: AnyFlowDef; readonly input: unknown; readonly wakeAt: number }
  >();
  // Same-process mutual exclusion per runId. The lease coordinates across
  // processes, but same-holder renew cannot distinguish two overlapping
  // sessions inside one process (boot orphan scan vs. scheduler tick).
  const inflightRuns = new Set<string>();
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
    return {
      store: fallbackJournalStore,
      instanceId: fallbackJournalInstanceId,
      leaseMs: JOURNAL_DEFAULT_LEASE_MS,
    };
  }

  async function handleCronFire(name: string): Promise<void> {
    await app.dispatchEvery(name);
    // Named clocks (e.g. `clock("expire-stale", { every: "1h" })`) reconcile
    // to a store row whose effective interval may differ from the cron name.
    const row = await bootResult?.clock?.store.get(name);
    if (row?.effectiveEvery && row.effectiveEvery !== name) {
      await app.dispatchEvery(row.effectiveEvery);
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
      try {
        await runDurable({
          flow: flowDef,
          input,
          journalStore: store,
          runId,
          ...(hasJournalLease(store) ? { lease: { instanceId, leaseMs } } : {}),
          now,
          fx: durableResumeFx(),
        });
      } catch (err) {
        if (isJournalLeaseBusy(err)) return;
        throw err;
      }
    } finally {
      inflightRuns.delete(runId);
    }
  }

  /** Boot-time orphan scan — `running`/`sleeping` runs with no live lease. */
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
    bootEnv = overrides?.env ?? options.env ?? "local";

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
      secrets: overrides?.secrets ?? options.secrets,
      vault: overrides?.vault ?? options.vault,
      gates: [...baseGates, ...authGates],
      signals: overrides?.signals ?? options.signals,
      clocks: overrides?.clocks ?? options.clocks,
      stores: overrides?.stores ?? options.stores,
      channel: overrides?.channel ?? options.channel,
      ai: overrides?.ai ?? options.ai,
      runs: overrides?.runs ?? options.runs,
      bindings: adopted,
      flows: [...flowsByName.values()],
    });
    const driverIds: string[] = [];
    for (const c of Object.values(caps)) {
      for (const d of c.declares) {
        if (d.startsWith("driver:")) driverIds.push(d.slice("driver:".length));
      }
    }
    const stores = overrides?.stores ?? options.stores ?? [];
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

    const baseSecrets = overrides?.secrets ?? options.secrets ?? [];
    const baseSignals = overrides?.signals ?? options.signals ?? [];
    const baseClocks = overrides?.clocks ?? options.clocks ?? [];
    const baseChannel = overrides?.channel ?? options.channel;
    const mergedCatalog = mergeTemplateCatalogs(baseChannel?.catalog, ...pluginChannelCatalogs);

    const merged: BootOptions = {
      env: bootEnv,
      docker: overrides?.docker ?? options.docker,
      config: overrides?.config ?? options.config,
      elements: overrides?.elements ?? options.elements,
      secrets: [...baseSecrets, ...pluginSecrets],
      vault: overrides?.vault ?? options.vault,
      gates: [...baseGates, ...authGates, ...pluginGates],
      unguardedHttp,
      signals: [...baseSignals, ...pluginSignals],
      clocks: [...baseClocks, ...pluginClocks],
      stores: overrides?.stores ?? options.stores,
      channel: {
        ...(baseChannel ?? {}),
        templates: [...(baseChannel?.templates ?? []), ...pluginChannelTemplates],
        ...(mergedCatalog ? { catalog: mergedCatalog } : {}),
        defaultLocale:
          baseChannel?.defaultLocale ??
          (overrides?.config ?? options.config)?.i18n?.default ??
          "en",
      },
      ai: overrides?.ai ?? options.ai,
      runs: overrides?.runs ?? options.runs,
      now: overrides?.now ?? options.fx?.now,
      instanceId: overrides?.instanceId,
      startScheduler: overrides?.startScheduler ?? options.startScheduler,
      schedulerIntervalMs: overrides?.schedulerIntervalMs ?? options.schedulerIntervalMs,
      journalLeaseMs: overrides?.journalLeaseMs ?? options.journalLeaseMs,
      bindings: adopted,
      flows: [...flowsByName.values()],
      onCronFire: overrides?.onCronFire ?? handleCronFire,
      onSignal: overrides?.onSignal ?? handleSignalFire,
      onDurableResume: overrides?.onDurableResume ?? handleDurableResume,
    };
    const result = await bootApplication(merged);
    bootResult = result;
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
      /** Frozen origin identity for {@link Fx.principal} across `fx.call`. */
      readonly originPrincipal?: FxPrincipal;
      /** Explicit locale override for {@link Fx.t} / channel sends. */
      readonly locale?: string;
      /** Parent WideEvent id when this execution was caused by another. */
      readonly parentId?: string;
      /** Explicit run / WideEvent id (defaults to a new UUID). */
      readonly runId?: string;
    },
  ): Promise<ExecuteResult> {
    registerFlow(flowDef);

    const i18nConfig = options.config?.i18n;
    const configuredLocales = i18nConfig?.locales ?? ["en", "ar"];
    const defaultLocale = i18nConfig?.default ?? "en";
    const acceptLanguage = extras?.request?.headers.get("accept-language") ?? undefined;
    const resolvedLocale = matchConfiguredLocale(
      extras?.locale ?? parseAcceptLanguage(acceptLanguage),
      configuredLocales,
      defaultLocale,
    );

    return runWithLocale({ locale: resolvedLocale, defaultLocale }, () =>
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
      readonly originPrincipal?: FxPrincipal;
      readonly locale?: string;
      readonly parentId?: string;
      readonly runId?: string;
    };
    readonly resolvedLocale: string;
    readonly defaultLocale: string;
  }): Promise<ExecuteResult> {
    const { flowDef, input, trigger, extras, resolvedLocale, defaultLocale } = args;
    const booted = await ensureBoot();

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
        },
        operator: { id: options.fx?.operator?.id ?? null },
      };

      // extras.principal / extras.auth are test-harness only — never from
      // a real HTTP request in production mode.
      const testMode = bootEnv === "test";
      if (testMode) {
        applyPrincipal(principals, extras?.auth as ResolvedPrincipal | undefined);
        applyPrincipal(principals, extras?.principal);
        if (extras?.operator) principals.operator.id = extras.operator.id;
      }

      const binding = authBinding;
      const cookieOpts = gateConfig.auth?.cookies;
      const elementHooks = createElementPipelineHooks({
        gates: booted.gate,
        principals,
        telemetry,
        allowTestPrincipals: testMode,
        verifyBearer: binding ? async (token) => verifyBearerToken(binding, token) : undefined,
        // Phase 1a: opt-in cookie → Bearer when Authorization is absent.
        resolveToken:
          binding && cookieOpts?.enabled
            ? (request) => {
                const header = request.headers.get("authorization");
                if (header?.startsWith("Bearer ")) {
                  return header.slice("Bearer ".length).trim() || undefined;
                }
                return tokenFromCookieHeader(request.headers.get("cookie"), cookieOpts);
              }
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

    const { fx, ledger } = createFxContext({
      ...options.fx,
      flow: flowDef.name,
      effects: flowDef.effects,
      runTelemetry: telemetry,
      runId,
      now,
      i18n: {
        locale: resolvedLocale,
        defaultLocale,
        catalogs: getMessageCatalogs(),
        ...options.fx?.i18n,
      },
      ...(principals ? { auth: principals.auth as FxAuth, operator: principals.operator } : {}),
      ...(extras?.originPrincipal ? { principal: extras.originPrincipal } : {}),
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
            originPrincipal: freezePrincipal(fx.principal),
            locale: resolvedLocale,
            parentId: runId,
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
            const run = () => {
              // Flow-level retry re-enters `do` on the same journal session —
              // rewind so completed steps/effects replay instead of re-executing.
              journalSession?.rewind();
              return flowDef.do(input as never, fx);
            };
            return flowDef.retry ? fxRetry(run, flowDef.retry) : run();
          };
          if (!alreadyValidated) {
            const parsed = await validate(flowDef.in, ctx.input);
            if (!parsed.ok) return parsed.failure;
            ctx.input = parsed.value;
            return await invoke(parsed.value);
          }
          return await invoke(ctx.input);
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
        if (flowDef.compensate) {
          try {
            const completedSteps = journalSession.run.entries
              .filter((e) => e.kind === "step")
              .map((e) => e.name);
            await flowDef.compensate(
              {
                input: ctx.input as never,
                error: terminalErr,
                completedSteps,
              },
              fx,
            );
          } catch (compErr) {
            await journalSession.commit("failed", {
              error: `compensate:${failureCodeOf(compErr)}`,
            });
          }
        }
        if (journalSession.run.status === "running") {
          await journalSession.commit("failed", {
            error: failureCodeOf(terminalErr),
          });
        }
      } else if (!sleeping) {
        await journalSession.commit("completed", { output: result.output });
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
          endedAt,
          failure: recordFailure,
          id: runId,
          input: replayInput,
          ...(parentId !== undefined ? { parentId } : {}),
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
      // Proactive lease release so survivors need not wait for TTL reclaim.
      await releaseInstanceLeases({
        bootResult: {
          clock: bootResult.clock,
          journal: bootResult.journal,
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
        const result = await runDurable({
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
      const started = performance.now();
      let flowLabel: string | undefined;
      const url = new URL(request.url);
      const method = request.method.toUpperCase();

      const respond = async (response: Response): Promise<Response> => {
        if (shouldLogDevRequests()) {
          logDevRequest({
            surface: currentDevSurface(),
            method,
            path: url.pathname,
            flow: flowLabel,
            status: response.status,
            ms: Math.round(performance.now() - started),
            detail: await failureDetailFromResponse(response),
          });
        }
        return response;
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
          new Response(JSON.stringify(routes), {
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
          return respond(encodeExecuteResult(internalResult));
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
        return respond(new Response("Not Found", { status: 404 }));
      }
      const { value: binding, params } = matched;
      flowLabel = binding.flow.name;

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

      return respond(encodeExecuteResult(result));
    },
    async dispatchSignal(signal, payload, meta) {
      const name = resolveName(signal);
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
    async dispatchEvery(interval) {
      const results: ExecuteResult[] = [];
      for (const b of adopted) {
        if (b.trigger.kind === "every" && b.trigger.interval === interval) {
          results.push(await execute(b.flow, undefined, b.trigger as EveryTrigger));
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

/** True when the pipeline ended in a terminal failure (not sleep park). */
function isTerminalFailure(result: PipelineResult): boolean {
  if (result.failure) return true;
  return result.ctx.error !== undefined && !isJournalSuspend(result.ctx.error);
}

/** Machine-readable code for journal / Runs failure fields. */
function failureCodeOf(err: unknown): string {
  if (isFlowFailure(err)) return err.error.code;
  if (err instanceof Error && err.name && err.name !== "Error") return err.name;
  if (err instanceof Error && err.message) return err.message.slice(0, 120);
  return "Error";
}

/** Coerce a thrown value into a FlowFailure for Runs wide events. */
function failureFromUnknown(err: unknown): FlowFailure {
  if (isFlowFailure(err)) return err;
  return fail(failureCodeOf(err), {});
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
