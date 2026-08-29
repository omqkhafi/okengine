/**
 * Ordered application boot — fail fast before a single request is served.
 *
 * ```
 * 1. Vault     — resolve every declared secret (list all gaps at once)
 * 2. Store     — bind drivers per environment; open connections
 * 3. Signals   — register declarations; start consumers
 * 4. Clocks    — reconcile into the Store
 * 4b. Journal  — bind the durable-run store (SKIP LOCKED + lease when shared)
 * 4c. Instances — fleet registry heartbeat (TTL liveness; off in test)
 * 4d. Scheduler — tick clocks + resume due durable runs + fleet heartbeat
 * 5. Channel   — bind channel runtime
 * 6. AI        — bind AI runtime
 * 7. Runs      — open the runs store
 * 8. Caps      — mint per-flow capability tokens from the Manifest / effects
 * ```
 *
 * Element runtimes are loaded via `new URL("./boot-bind/"+name+".ts", …)` so
 * unused binders stay out of the `oke()` bundle (semantic tree-shaking).
 * Vault still loads whenever secrets are declared and lists every gap in one
 * failure; capability minting uses flow effect refs only — no element modules,
 * except a lazy `extractManifest` import when a flow has no hand-declared
 * `effects` and neither {@link BootOptions.manifest} nor
 * {@link BootOptions.rootDir} / `OKE_ROOT_DIR` are set to derive one.
 *
 * The scheduler reads the effective state from the Store after reconciliation,
 * never the code directly (console §5).
 */

import { resolveDriverId, type ConfigEnv, type OkeConfig } from "../config/index.ts";
import { CLOCK_DEFAULTS, JOURNAL_DEFAULTS } from "../config/driver-defaults.ts";
import type { AiRuntime, CreateAiRuntimeOptions } from "../elements/ai.ts";
import type { ChannelRuntime, CreateChannelRuntimeOptions } from "../elements/channel.ts";
import type { ClockDecl, ClockRuntime } from "../elements/clock.ts";
import type { GateDecl, GateRuntime } from "../elements/gate.ts";
import type { SignalDecl, SignalRuntime } from "../elements/signal.ts";
import type { StoreDecl, StoreRuntime } from "../elements/store.ts";
import type {
  CreateVaultRuntimeOptions,
  VaultRuntime,
  VaultSecretDecl,
} from "../elements/vault.ts";
import type { JournalRuntime } from "./boot-bind/journal.ts";
import type { InstanceRuntime, InstanceStore } from "./instances.ts";
import { resolveInstanceId } from "./instance-id.ts";
import {
  resolveRunsConsoleBridge,
  wrapRunsForConsoleIngest,
  type CreateRunsRuntimeOptions,
  type RunsConsoleBridgeTarget,
  type RunsRuntime,
} from "../runs/index.ts";
import { createCapabilityToken, type CapabilityToken } from "./capability.ts";
import { throwOke } from "./errors.ts";
import type { AnyFlowDef } from "./flow.ts";
import type { Binding } from "./on.ts";
import type { Manifest } from "../manifest/types.ts";
import { emitBootWarn } from "../runtime/boot-warn.ts";

/** Pre-built or partially-built element runtimes. */
export interface ElementRuntimes {
  readonly vault?: VaultRuntime;
  readonly store?: StoreRuntime;
  readonly signal?: SignalRuntime;
  readonly clock?: ClockRuntime;
  readonly gate?: GateRuntime;
  readonly channel?: ChannelRuntime;
  readonly ai?: AiRuntime;
  readonly runs?: RunsRuntime;
  /** Pre-bound durable-run journal (skips driver resolution). */
  readonly journal?: JournalRuntime;
  /** Pre-bound fleet registry (skips driver resolution). */
  readonly instances?: InstanceRuntime;
}

/** Declarations + options consumed by {@link bootApplication}. */
export interface BootOptions {
  /**
   * Active {@link ConfigEnv} (`dev` · `test` · `prod`).
   * Default: `prod` when `NODE_ENV=production`; `dev` when Compose is up
   * ({@link docker} / `OKE_DOCKER=1`); otherwise `test`.
   */
  readonly env?: ConfigEnv;
  /**
   * Compose infra is up (`oke dev` / `OKE_DOCKER=1`): prefer compose URLs
   * (`.env.local`) and resolve {@link env} to `dev` when unset.
   * When unset, derived from `process.env.OKE_DOCKER`.
   */
  readonly docker?: boolean;
  /** Optional `oke.config.ts` document. */
  readonly config?: OkeConfig;
  /** Pre-built runtimes (skip construction when present). */
  readonly elements?: ElementRuntimes;
  /** Vault secret contracts. */
  readonly secrets?: readonly VaultSecretDecl[];
  /** Vault create options (chain / allowDevFallbacks). */
  readonly vault?: Omit<CreateVaultRuntimeOptions, "secrets"> & {
    readonly secrets?: readonly VaultSecretDecl[];
  };
  /** Gate declarations for the runtime. */
  readonly gates?: readonly GateDecl[];
  /**
   * HTTP auth-posture enforcement at boot.
   * - `"deny"` (default) — every HTTP trigger must carry a gate or `.public()`
   * - `"allow"` — skips the audit **only** when {@link env} is `"test"`;
   *   ignored in local/prod/docker (never a production-wide bypass).
   *   Migrate real apps with per-trigger `.public()`.
   */
  readonly unguardedHttp?: "deny" | "allow";
  /** Signal declarations. */
  readonly signals?: readonly SignalDecl[];
  /** Named clock declarations. */
  readonly clocks?: readonly ClockDecl[];
  /** Store facet declarations to register. */
  readonly stores?: readonly StoreDecl[];
  /** Channel runtime options. */
  readonly channel?: CreateChannelRuntimeOptions;
  /** AI runtime options. */
  readonly ai?: CreateAiRuntimeOptions;
  /** Runs runtime or create options. */
  readonly runs?: RunsRuntime | CreateRunsRuntimeOptions;
  /**
   * Push recorded WideEvents to Console ingest (`oke dev` live Traces bridge).
   * When set (or via `OKE_RUNS_INGEST_*` env), boot enables a runs store
   * automatically (`files` in `dev`/`prod`, `memory` in `test`). `false`
   * disables env lookup. Prod recording stays opt-in — only `oke dev`
   * sets the env.
   */
  readonly runsBridge?: RunsConsoleBridgeTarget | false;
  /** Adopted bindings (for every→cron + signal consumers). */
  readonly bindings?: readonly Binding[];
  /** Flows known to the app (for capability minting). */
  readonly flows?: readonly AnyFlowDef[];
  /**
   * Compiled Manifest to derive capability tokens from for flows with no
   * hand-declared `effects` (highest priority — build tooling / bundler
   * import, never a filesystem read the kernel performs itself).
   */
  readonly manifest?: Manifest;
  /**
   * Project root for a lazy, best-effort `extractManifest` when a flow has
   * no hand-declared `effects` and no {@link manifest} was given. Explicit
   * opt-in only — never defaults to `process.cwd()` — so the existing test
   * suite (hundreds of boots against synthetic flows, not a real source
   * tree) never pays extraction cost. Falls back to `OKE_ROOT_DIR` when
   * unset (the CLI sets this for `oke dev` / `oke start`).
   */
  readonly rootDir?: string;
  /**
   * Dispatch a cron / every interval when the scheduler fires.
   *
   * @param name - Cron name or every-interval
   */
  readonly onCronFire?: (name: string) => void | Promise<void>;
  /** Tenant ids for per-tenant clock expansion at reconcile. */
  readonly tenantIds?: () => readonly string[] | Promise<readonly string[]>;
  /**
   * Dispatch a signal message to bound flows.
   *
   * @param signal - Signal name
   * @param payload - Payload
   * @param meta - Optional envelope (producer run id for trace chains)
   */
  readonly onSignal?: (
    signal: string,
    payload: unknown,
    meta?: { readonly parentRunId?: string; readonly messageId?: string },
  ) => void | Promise<void>;
  /**
   * Resume due durable runs — called on every scheduler tick when any flow
   * declares `durable: true` (claimDueSleep on the shared journal store).
   */
  readonly onDurableResume?: () => void | Promise<void>;
  /** Durable-run lease duration ms (default 30_000 — matches Signal claims). */
  readonly journalLeaseMs?: number;
  /** Injectable clock for test / frozen harnesses. */
  readonly now?: () => number;
  /**
   * Test-only client injection for binders that open redis / signal redis.
   * Production apps leave this unset.
   */
  readonly clients?: {
    readonly kv?: import("../drivers/types.ts").KvClientLike;
    readonly signalRedis?: import("../drivers/signal-types.ts").SignalRedisClientLike;
  };
  /**
   * Process instance id for Clock / Journal / fleet registry.
   * When unset, boot mints one `inst-<uuid>` and passes it to every binder.
   */
  readonly instanceId?: string;
  /** Injected fleet store (chaos / tests — activates the registry in `test`). */
  readonly instanceStore?: InstanceStore;
  /** Fleet heartbeat write interval ms (default 5_000). */
  readonly instanceHeartbeatMs?: number;
  /** Fleet presence TTL ms (default 30_000 — matches Clock / Journal). */
  readonly instanceLeaseMs?: number;
  /**
   * Start a background scheduler tick loop.
   * Default: `true` when `env !== "test"`; `false` in test (opt in explicitly).
   * Opt out in production with `startScheduler: false`.
   */
  readonly startScheduler?: boolean;
  /** Scheduler tick period ms (default 1000). */
  readonly schedulerIntervalMs?: number;
}

/** Result of a successful boot. */
export interface BootResult {
  readonly vault?: VaultRuntime;
  readonly store?: StoreRuntime;
  readonly signal?: SignalRuntime;
  readonly clock?: ClockRuntime;
  readonly gate?: GateRuntime;
  readonly channel?: ChannelRuntime;
  readonly ai?: AiRuntime;
  readonly runs?: RunsRuntime;
  /** Durable-run journal (present when any flow declares `durable: true`). */
  readonly journal?: JournalRuntime;
  /**
   * Unified process instance id (Clock, Journal, and the fleet registry
   * share this value).
   */
  readonly instanceId: string;
  /** Fleet registry (absent in `test` unless a store is injected). */
  readonly instances?: InstanceRuntime;
  /** Per-flow capability tokens minted from declared effects. */
  readonly capabilities: ReadonlyMap<string, CapabilityToken>;
  /** Stop the background scheduler (if started). */
  stopScheduler(): void;
  /** Close element runtimes. */
  close(): Promise<void>;
}

/** Which element runtimes a boot must construct / import. */
export interface ElementNeeds {
  readonly vault: boolean;
  readonly store: boolean;
  readonly signal: boolean;
  readonly clock: boolean;
  readonly gate: boolean;
  readonly channel: boolean;
  readonly ai: boolean;
  readonly runs: boolean;
  /** Durable-run journal — any flow with `durable: true`. */
  readonly journal: boolean;
}

/**
 * Decide which element runtimes are required from BootOptions alone —
 * declaration arrays, pre-built runtimes, flow effects, and bindings.
 * Does not import any element runtime module.
 *
 * @param options - Boot declarations
 */
export function resolveElementNeeds(options: BootOptions): ElementNeeds {
  const pre = options.elements ?? {};
  let vault =
    pre.vault !== undefined ||
    (options.vault?.secrets ?? options.secrets ?? []).length > 0 ||
    (options.vault?.requiredEnv?.length ?? 0) > 0;
  let store = pre.store !== undefined || (options.stores?.length ?? 0) > 0;
  let signal = pre.signal !== undefined || (options.signals?.length ?? 0) > 0;
  let clock = pre.clock !== undefined || (options.clocks?.length ?? 0) > 0;
  let gate = pre.gate !== undefined || (options.gates?.length ?? 0) > 0;
  let channel = pre.channel !== undefined || options.channel !== undefined;
  let ai = pre.ai !== undefined || options.ai !== undefined;
  let runs =
    pre.runs !== undefined ||
    options.runs !== undefined ||
    resolveRunsConsoleBridge(options.runsBridge) !== null;
  let journal = pre.journal !== undefined;

  const considerFlow = (f: AnyFlowDef): void => {
    const e = f.effects;
    if (f.durable === true) journal = true;
    if ((e?.reads?.length ?? 0) > 0 || (e?.writes?.length ?? 0) > 0) {
      store = true;
    }
    if ((e?.emits?.length ?? 0) > 0) signal = true;
    if ((e?.secrets?.length ?? 0) > 0) vault = true;
    if ((e?.sends?.length ?? 0) > 0) channel = true;
    if ((e?.asks?.length ?? 0) > 0) ai = true;
    for (const t of f.triggers) {
      if (t.kind === "clock" || t.kind === "every") clock = true;
      if (t.kind === "signal") signal = true;
      if (t.kind === "cdc") store = true;
      if (t.kind === "http" && t.gates.length > 0) gate = true;
    }
  };

  for (const f of options.flows ?? []) considerFlow(f);
  for (const b of options.bindings ?? []) {
    considerFlow(b.flow);
    const t = b.trigger;
    if (t.kind === "clock" || t.kind === "every") clock = true;
    if (t.kind === "signal") signal = true;
    if (t.kind === "cdc") store = true;
    if (t.kind === "http" && t.gates.length > 0) gate = true;
  }

  // AI agents share the gate runtime for tool checks.
  if (ai) gate = true;
  if (options.onSignal && (options.bindings ?? []).some((b) => b.trigger.kind === "signal")) {
    signal = true;
  }

  return { vault, store, signal, clock, gate, channel, ai, runs, journal };
}

/**
 * Whether boot should open the fleet registry.
 *
 * `test` stays off unless a store is injected. `dev`/`prod` activate when
 * a shared SQL URL exists and Clock or Journal is actually postgres — or
 * when the app has neither (HTTP-only replicas still census on Postgres).
 *
 * @param options - Boot options
 * @param env - Active environment
 * @param needs - Resolved element needs
 */
function shouldBindFleetRegistry(
  options: BootOptions,
  env: ConfigEnv,
  needs: ElementNeeds,
): boolean {
  if (options.elements?.instances !== undefined) return true;
  if (options.instanceStore !== undefined) return true;
  if (env === "test") return false;
  const url = process.env.DATABASE_URL ?? process.env.OKE_STORE_SQL_URL;
  if (!url) return false;
  const clockDriver = resolveDriverId(options.config?.drivers?.clock, env, CLOCK_DEFAULTS);
  const journalDriver = resolveDriverId(options.config?.drivers?.journal, env, JOURNAL_DEFAULTS);
  if (needs.clock && clockDriver === "postgres") return true;
  if (needs.journal && journalDriver === "postgres") return true;
  return !needs.clock && !needs.journal;
}

/**
 * Dynamically load a boot-bind module without pulling it into the bundler
 * graph (expression `new URL` — Bun resolves at runtime).
 *
 * @param name - Binder file stem (`store`, `vault`, …)
 */
async function loadBind<T>(name: string): Promise<T> {
  const url = new URL(`./boot-bind/${name}.ts`, import.meta.url);
  return import(url.href) as Promise<T>;
}

/**
 * Run the ordered boot sequence. Fails fast — a missing secret throws
 * before store/signal/… open, so no request can be served.
 *
 * @param options - Declarations, config, pre-built runtimes
 */
export async function bootApplication(input: BootOptions = {}): Promise<BootResult> {
  const docker =
    input.docker === true || (input.docker !== false && process.env.OKE_DOCKER === "1");
  // Three targets: `prod` when NODE_ENV=production; `dev` when compose infra
  // is up (`oke dev` / `OKE_DOCKER=1`); otherwise `test` (PGLite / memory).
  const env: ConfigEnv =
    input.env ?? (process.env.NODE_ENV === "production" ? "prod" : docker ? "dev" : "test");
  let config = input.config;
  if (config === undefined) {
    try {
      const { loadOkeConfig } = await import("../cli/load-config.ts");
      config = (await loadOkeConfig(process.cwd())).config;
    } catch {
      config = undefined;
    }
  }
  const instanceId = resolveInstanceId(input.instanceId);
  const options: BootOptions = { ...input, config, env, docker, instanceId };
  const pre = options.elements ?? {};
  const now = options.now ?? (() => Date.now());
  const needs = resolveElementNeeds(options);

  // 1. Vault — module loads only when secrets (or a pre-built vault) exist.
  let vault = pre.vault;
  if (needs.vault) {
    if (!vault) {
      const { bindVault } = await loadBind<typeof import("./boot-bind/vault.ts")>("vault");
      vault = await bindVault(options, env);
    } else if (!vault.booted) {
      await vault.boot();
    }
  }

  // Parallel-load remaining binders after Vault fail-fast.
  const binderLoads: Promise<unknown>[] = [];
  type StoreBind = typeof import("./boot-bind/store.ts");
  type SignalBind = typeof import("./boot-bind/signal.ts");
  type ClockBind = typeof import("./boot-bind/clock.ts");
  type JournalBind = typeof import("./boot-bind/journal.ts");
  type GateBind = typeof import("./boot-bind/gate.ts");
  type ChannelBind = typeof import("./boot-bind/channel.ts");
  type AiBind = typeof import("./boot-bind/ai.ts");
  type RunsBind = typeof import("./boot-bind/runs.ts");
  type InstancesBind = typeof import("./boot-bind/instances.ts");

  let storeBind: StoreBind | undefined;
  let signalBind: SignalBind | undefined;
  let clockBind: ClockBind | undefined;
  let journalBind: JournalBind | undefined;
  let gateBind: GateBind | undefined;
  let channelBind: ChannelBind | undefined;
  let aiBind: AiBind | undefined;
  let runsBind: RunsBind | undefined;
  let instancesBind: InstancesBind | undefined;

  if (needs.store && !pre.store) {
    binderLoads.push(
      loadBind<StoreBind>("store").then((m) => {
        storeBind = m;
      }),
    );
  }
  if (needs.signal && !pre.signal) {
    binderLoads.push(
      loadBind<SignalBind>("signal").then((m) => {
        signalBind = m;
      }),
    );
  }
  if (needs.clock) {
    binderLoads.push(
      loadBind<ClockBind>("clock").then((m) => {
        clockBind = m;
      }),
    );
  }
  if (needs.journal && !pre.journal) {
    binderLoads.push(
      loadBind<JournalBind>("journal").then((m) => {
        journalBind = m;
      }),
    );
  }
  const wantInstances = shouldBindFleetRegistry(options, env, needs);
  if (wantInstances && !pre.instances) {
    binderLoads.push(
      loadBind<InstancesBind>("instances").then((m) => {
        instancesBind = m;
      }),
    );
  }
  if (needs.gate && !pre.gate) {
    binderLoads.push(
      loadBind<GateBind>("gate").then((m) => {
        gateBind = m;
      }),
    );
  }
  if (needs.channel && !pre.channel) {
    binderLoads.push(
      loadBind<ChannelBind>("channel").then((m) => {
        channelBind = m;
      }),
    );
  }
  if (needs.ai && !pre.ai) {
    binderLoads.push(
      loadBind<AiBind>("ai").then((m) => {
        aiBind = m;
      }),
    );
  }
  if (needs.runs && !pre.runs && !(options.runs && isRunsRuntime(options.runs))) {
    binderLoads.push(
      loadBind<RunsBind>("runs").then((m) => {
        runsBind = m;
      }),
    );
  }
  await Promise.all(binderLoads);

  // 2. Store
  let store = pre.store;
  if (needs.store) {
    if (!store) {
      store = storeBind!.bindStore(options, env, now, docker);
    } else {
      for (const decl of options.stores ?? []) {
        store.register?.(decl);
      }
    }
  }

  // 3. Signals
  let signal = pre.signal;
  if (needs.signal) {
    if (!signal) {
      signal = await signalBind!.bindSignal(options, env, now, docker);
    } else {
      // Pre-built: still register decls / start if needed.
      for (const decl of options.signals ?? []) {
        signal.register(decl);
      }
      if (!signal.bus) {
        await signal.start();
      }
    }
  }

  // 4. Clocks
  let clock = pre.clock;
  if (needs.clock) {
    const bound = await clockBind!.bindClock(options, env, now, clock);
    clock = bound.clock;
  }

  // 4b. Journal — durable-run store (shared + leased when a driver is bound).
  let journal = pre.journal;
  if (needs.journal && !journal) {
    journal = (await journalBind!.bindJournal(options, env)).journal;
  }

  // 4c. Fleet registry — one row per process (TTL liveness). Off in `test`
  // unless a store is injected. Shares the 1s scheduler timer; writes every 5s.
  let instances = pre.instances;
  if (!instances && instancesBind) {
    instances = (await instancesBind.bindInstances(options, env, instanceId, now))?.instances;
  }

  // 4d. Scheduler — one timer drives clock ticks, durable-run resume, heartbeat.
  let schedulerTimer: ReturnType<typeof setInterval> | undefined;
  const startScheduler = options.startScheduler ?? env !== "test";
  if (startScheduler && (clock !== undefined || journal !== undefined || instances !== undefined)) {
    const period = options.schedulerIntervalMs ?? 1000;
    const clockRt = clock;
    const durableResume = options.onDurableResume;
    const fleet = instances;
    schedulerTimer = setInterval(() => {
      if (clockRt) void clockRt.tick();
      if (journal && durableResume) void durableResume();
      if (fleet) void fleet.maybeHeartbeat();
    }, period);
    schedulerTimer.unref?.();
  }

  // Gate (before AI)
  let gate = pre.gate;
  if (needs.gate && !gate) {
    gate = await gateBind!.bindGate(options, now, env, docker);
  }

  // 5. Channel
  let channel = pre.channel;
  if (needs.channel && !channel) {
    channel = channelBind!.bindChannel(options, env, now, docker);
  }

  // 6. AI
  let ai = pre.ai;
  if (needs.ai && !ai) {
    ai = aiBind!.bindAi(options, gate, now, env, docker, vault);
  }

  // 7. Runs
  let runs = pre.runs;
  const runsBridge = resolveRunsConsoleBridge(options.runsBridge);
  if (needs.runs || runsBridge) {
    if (!runs) {
      if (options.runs && isRunsRuntime(options.runs)) {
        runs = options.runs;
        if (!runs.store) await runs.open();
      } else {
        const runsOpts = options.runs && !isRunsRuntime(options.runs) ? options.runs : undefined;
        if (!runsBind) {
          const m = await loadBind<RunsBind>("runs");
          runsBind = m;
        }
        runs = await runsBind!.bindRuns(options, env, runsOpts);
      }
    } else if (!runs.store) {
      await runs.open();
    }
    if (runs && runsBridge) {
      runs = wrapRunsForConsoleIngest(runs, runsBridge);
    }
  }

  // 8. Caps — effect refs only; no element modules (unless a lazy extract is needed).
  const capabilities = await mintCapabilities(options.flows ?? [], env, {
    manifest: options.manifest,
    rootDir: options.rootDir,
    docker,
  });

  // 9. `.adopt()` barrel freshness — opt-in only (same `rootDir` gate as
  // capability minting above; never a filesystem read the kernel performs
  // on its own).
  await assertAdoptBarrelFresh(options.flows ?? [], env, options.rootDir, docker);

  return {
    vault,
    store,
    signal,
    clock,
    gate,
    channel,
    ai,
    runs,
    journal,
    instanceId,
    instances,
    capabilities,
    stopScheduler() {
      if (schedulerTimer !== undefined) {
        clearInterval(schedulerTimer);
        schedulerTimer = undefined;
      }
      clock?.stopWakes();
    },
    async close() {
      if (schedulerTimer !== undefined) {
        clearInterval(schedulerTimer);
        schedulerTimer = undefined;
      }
      clock?.stopWakes();
      await signal?.close();
      await vault?.close();
      await runs?.flush();
      const journalStore = journal?.store as { close?: () => Promise<void> } | undefined;
      await journalStore?.close?.();
      await instances?.close();
    },
  };
}

/** Per-process guard so the "no effects" boot warning fires once, not per-flow. */
let noEffectsWarned = false;

/** Reset the once-per-process "no effects" warn latch (tests only). */
export function resetNoEffectsWarnForTests(): void {
  noEffectsWarned = false;
}

/**
 * Best-effort AoT extraction from `rootDir` — mirrors the CLI's own lazy,
 * defensive `extractManifest` use (`oke dev`'s `tryLoadProjectManifest`).
 * Never throws: a broken or mid-edit source tree just means "no Manifest
 * available," handled by the caller like any other missing Manifest.
 *
 * `new URL` (not a literal specifier) so `oxc-parser` / the whole compiler
 * never enters the bundler graph for apps that never hit this path — same
 * trick as {@link loadBind} for the element binders.
 *
 * @param rootDir - Project root to extract from
 */
async function tryAutoExtractManifest(rootDir: string): Promise<Manifest | undefined> {
  try {
    const url = new URL("../compiler/extract.ts", import.meta.url);
    const { extractManifest } = (await import(url.href)) as typeof import("../compiler/extract.ts");
    return await extractManifest({ rootDir });
  } catch {
    return undefined;
  }
}

/**
 * Mint capability tokens from each flow's declared effects, falling back to
 * a Manifest-derived stamp when a flow declares no `effects` of its own —
 * an explicit {@link BootOptions.manifest}, or a lazy AoT extract from
 * {@link BootOptions.rootDir} / `OKE_ROOT_DIR`.
 *
 * When neither is available: `test` stays open with a once-per-process
 * `oke boot:` warning; `dev` with compose infra and `prod` fail loud
 * (`OKE1008`) — never a silent open door in a deploy-shaped environment.
 *
 * @param flows - Adopted flows
 * @param env - Resolved {@link ConfigEnv}
 * @param options - Manifest / rootDir sources for the fallback stamp
 */
export async function mintCapabilities(
  flows: readonly AnyFlowDef[],
  env: ConfigEnv = "test",
  options: {
    readonly manifest?: Manifest;
    readonly rootDir?: string;
    readonly docker?: boolean;
  } = {},
): Promise<Map<string, CapabilityToken>> {
  const map = new Map<string, CapabilityToken>();

  let manifest = options.manifest;
  const needsManifest = manifest === undefined && flows.some((f) => f.effects === undefined);
  if (needsManifest) {
    const rootDir = options.rootDir ?? process.env["OKE_ROOT_DIR"];
    if (rootDir) manifest = await tryAutoExtractManifest(rootDir);
  }

  for (const f of flows) {
    if (f.effects !== undefined) {
      map.set(f.name, createCapabilityToken(f.name, f.effects));
      continue;
    }

    const stamped = manifest?.flows?.[f.name]?.effects;
    if (stamped !== undefined) {
      map.set(f.name, createCapabilityToken(f.name, stamped));
      continue;
    }

    const strict = env === "prod" || (env === "dev" && options.docker === true);
    if (strict) {
      throwOke("NO_EFFECTS_DECLARED", { flow: f.name });
    }
    if (!noEffectsWarned) {
      noEffectsWarned = true;
      emitBootWarn(
        `oke boot: flow "${f.name}" (and possibly others) has no declared effects and no ` +
          "Manifest-derived effects — running with an OPEN capability token (every access " +
          "allowed, ledgered but not gated). Run `oke build`, or boot with `manifest` / " +
          "`rootDir`, before deploying — dev+compose/prod refuse to boot this way.",
      );
    }
    map.set(f.name, createCapabilityToken(f.name, undefined));
  }
  return map;
}

/** Per-process guard so the stale-barrel boot warning fires once. */
let staleAdoptBarrelWarned = false;

/** Reset the once-per-process stale-barrel warn latch (tests only). */
export function resetStaleAdoptBarrelWarnForTests(): void {
  staleAdoptBarrelWarned = false;
}

/**
 * Best-effort disk scan for `<rootDir>/src/flows/*` unit folders — mirrors
 * {@link tryAutoExtractManifest}'s lazy, defensive, never-throws posture and
 * the same `new URL` trick so the generator never enters the bundler graph
 * for apps that never opt into `rootDir`.
 *
 * @param rootDir - Project root to scan
 */
async function tryListFlowsUnits(rootDir: string): Promise<readonly string[] | undefined> {
  try {
    const url = new URL("../compiler/generate-adopt.ts", import.meta.url);
    const { generateAdoptBarrel } = (await import(
      url.href
    )) as typeof import("../compiler/generate-adopt.ts");
    return (await generateAdoptBarrel({ rootDir })).units;
  } catch {
    return undefined;
  }
}

/**
 * Confirm every `src/flows/<unit>` folder on disk actually reached this
 * boot's adopted flows — the disk-file counterpart of a stale/missing
 * generated `.adopt()` barrel (`src/flows/generated.ts`). A folder present
 * on disk with zero adopted flows under that unit means the barrel wasn't
 * regenerated (or was hand-edited) after the folder was added.
 *
 * Opt-in only via {@link BootOptions.rootDir} / `OKE_ROOT_DIR` (same gate as
 * {@link mintCapabilities}'s Manifest fallback) — never a filesystem read
 * the kernel performs on its own. `test` warns once per process; `prod`
 * (and `dev` with compose) fail loud (`OKE1009`) — same class as
 * `NO_EFFECTS_DECLARED`, never a silently-incomplete route table in a
 * deploy-shaped environment.
 *
 * @param flows - Adopted flows
 * @param env - Resolved {@link ConfigEnv}
 * @param rootDir - Explicit project root (falls back to `OKE_ROOT_DIR`)
 * @param docker - Compose infra active (`oke dev`)
 */
export async function assertAdoptBarrelFresh(
  flows: readonly AnyFlowDef[],
  env: ConfigEnv = "test",
  rootDir?: string,
  docker = false,
): Promise<void> {
  const dir = rootDir ?? process.env["OKE_ROOT_DIR"];
  if (!dir) return;

  const diskUnits = await tryListFlowsUnits(dir);
  if (diskUnits === undefined || diskUnits.length === 0) return;

  const adoptedUnits = new Set(
    flows.map((f) => f.unit).filter((u): u is string => u !== undefined),
  );
  const missing = diskUnits.filter((u) => !adoptedUnits.has(u));
  if (missing.length === 0) return;

  const strict = env === "prod" || (env === "dev" && docker);
  if (strict) {
    throwOke("ADOPT_BARREL_STALE", { unit: missing[0]! });
  }
  if (!staleAdoptBarrelWarned) {
    staleAdoptBarrelWarned = true;
    emitBootWarn(
      `oke boot: src/flows/${missing[0]} exists on disk but adopted no flows — the ` +
        '.adopt() barrel ("src/flows/generated.ts") is stale. Run `oke dev` or `oke build` ' +
        "to regenerate it — dev+compose/prod refuse to boot this way.",
    );
  }
}

function isRunsRuntime(value: RunsRuntime | CreateRunsRuntimeOptions): value is RunsRuntime {
  return (
    typeof value === "object" &&
    value !== null &&
    "record" in value &&
    typeof (value as RunsRuntime).record === "function"
  );
}
