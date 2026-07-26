/**
 * Ordered application boot — fail fast before a single request is served.
 *
 * ```
 * 1. Vault     — resolve every declared secret (list all gaps at once)
 * 2. Store     — bind drivers per environment; open connections
 * 3. Signals   — register declarations; start consumers
 * 4. Clocks    — reconcile into the Store; start scheduler (leader election)
 * 5. Channel   — bind channel runtime
 * 6. AI        — bind AI runtime
 * 7. Runs      — open the runs store
 * 8. Caps      — mint per-flow capability tokens from the Manifest / effects
 * ```
 *
 * Element runtimes are loaded via `new URL("./boot-bind/"+name+".ts", …)` so
 * unused binders stay out of the `oke()` bundle (semantic tree-shaking).
 * Vault still loads whenever secrets are declared and lists every gap in one
 * failure; capability minting uses flow effect refs only — no element modules.
 *
 * The scheduler reads the effective state from the Store after reconciliation,
 * never the code directly (console §5).
 */

import type { ConfigEnv, OkeConfig } from "../config/index.ts";
import type {
  AiRuntime,
  CreateAiRuntimeOptions,
} from "../elements/ai.ts";
import type {
  ChannelRuntime,
  CreateChannelRuntimeOptions,
} from "../elements/channel.ts";
import type {
  ClockDecl,
  ClockRuntime,
} from "../elements/clock.ts";
import type {
  GateDecl,
  GateRuntime,
} from "../elements/gate.ts";
import type {
  SignalDecl,
  SignalRuntime,
} from "../elements/signal.ts";
import type {
  StoreDecl,
  StoreRuntime,
} from "../elements/store.ts";
import type {
  CreateVaultRuntimeOptions,
  VaultRuntime,
  VaultSecretDecl,
} from "../elements/vault.ts";
import type {
  CreateRunsRuntimeOptions,
  RunsRuntime,
} from "../runs/index.ts";
import {
  createCapabilityToken,
  type CapabilityToken,
} from "./capability.ts";
import type { AnyFlowDef } from "./flow.ts";
import type { Binding } from "./on.ts";

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
}

/** Declarations + options consumed by {@link bootApplication}. */
export interface BootOptions {
  /**
   * Active environment (defaults to `dev`, or `stack` when
   * {@link stack} / `OKE_STACK=1`).
   */
  readonly env?: ConfigEnv;
  /**
   * Local-server mode (`oke dev -s` / `OKE_STACK=1`): force driver maps to the
   * `stack` profile and prefer compose URLs (`.env.stack`).
   * When unset, derived from `process.env.OKE_STACK`.
   */
  readonly stack?: boolean;
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
  /** Adopted bindings (for every→cron + signal consumers). */
  readonly bindings?: readonly Binding[];
  /** Flows known to the app (for capability minting). */
  readonly flows?: readonly AnyFlowDef[];
  /**
   * Dispatch a cron / every interval when the scheduler fires.
   *
   * @param name - Cron name or every-interval
   */
  readonly onCronFire?: (name: string) => void | Promise<void>;
  /**
   * Dispatch a signal message to bound flows.
   *
   * @param signal - Signal name
   * @param payload - Payload
   */
  readonly onSignal?: (
    signal: string,
    payload: unknown,
  ) => void | Promise<void>;
  /** Injectable clock for test / frozen harnesses. */
  readonly now?: () => number;
  /** Instance id for leader election. */
  readonly instanceId?: string;
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
    (options.vault?.secrets ?? options.secrets ?? []).length > 0;
  let store = pre.store !== undefined || (options.stores?.length ?? 0) > 0;
  let signal = pre.signal !== undefined || (options.signals?.length ?? 0) > 0;
  let clock = pre.clock !== undefined || (options.clocks?.length ?? 0) > 0;
  let gate = pre.gate !== undefined || (options.gates?.length ?? 0) > 0;
  let channel = pre.channel !== undefined || options.channel !== undefined;
  let ai = pre.ai !== undefined || options.ai !== undefined;
  let runs = pre.runs !== undefined || options.runs !== undefined;

  const considerFlow = (f: AnyFlowDef): void => {
    const e = f.effects;
    if ((e?.reads?.length ?? 0) > 0 || (e?.writes?.length ?? 0) > 0) {
      store = true;
    }
    if ((e?.emits?.length ?? 0) > 0) signal = true;
    if ((e?.secrets?.length ?? 0) > 0) vault = true;
    if ((e?.sends?.length ?? 0) > 0) channel = true;
    if ((e?.asks?.length ?? 0) > 0) ai = true;
    for (const t of f.triggers) {
      if (t.kind === "every") clock = true;
      if (t.kind === "signal") signal = true;
      if (t.kind === "cdc") store = true;
      if (t.kind === "http" && t.gates.length > 0) gate = true;
    }
  };

  for (const f of options.flows ?? []) considerFlow(f);
  for (const b of options.bindings ?? []) {
    considerFlow(b.flow);
    const t = b.trigger;
    if (t.kind === "every") clock = true;
    if (t.kind === "signal") signal = true;
    if (t.kind === "cdc") store = true;
    if (t.kind === "http" && t.gates.length > 0) gate = true;
  }

  // AI agents share the gate runtime for tool checks.
  if (ai) gate = true;
  if (
    options.onSignal &&
    (options.bindings ?? []).some((b) => b.trigger.kind === "signal")
  ) {
    signal = true;
  }

  return { vault, store, signal, clock, gate, channel, ai, runs };
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
export async function bootApplication(
  input: BootOptions = {},
): Promise<BootResult> {
  const stack =
    input.stack === true ||
    (input.stack !== false && process.env.OKE_STACK === "1");
  // `-s` always selects the `stack` driver profile — not a mix of test/dev +
  // prod store overrides (templates often pin `env: "test"` for harnesses).
  const env: ConfigEnv = stack ? "stack" : (input.env ?? "dev");
  let config = input.config;
  if (config === undefined) {
    try {
      const { loadOkeConfig } = await import("../cli/load-config.ts");
      config = (await loadOkeConfig(process.cwd())).config;
    } catch {
      config = undefined;
    }
  }
  const options: BootOptions = { ...input, config, env, stack };
  const pre = options.elements ?? {};
  const now = options.now ?? (() => Date.now());
  const needs = resolveElementNeeds(options);

  // 1. Vault — module loads only when secrets (or a pre-built vault) exist.
  let vault = pre.vault;
  if (needs.vault) {
    if (!vault) {
      const { bindVault } = await loadBind<
        typeof import("./boot-bind/vault.ts")
      >("vault");
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
  type GateBind = typeof import("./boot-bind/gate.ts");
  type ChannelBind = typeof import("./boot-bind/channel.ts");
  type AiBind = typeof import("./boot-bind/ai.ts");
  type RunsBind = typeof import("./boot-bind/runs.ts");

  let storeBind: StoreBind | undefined;
  let signalBind: SignalBind | undefined;
  let clockBind: ClockBind | undefined;
  let gateBind: GateBind | undefined;
  let channelBind: ChannelBind | undefined;
  let aiBind: AiBind | undefined;
  let runsBind: RunsBind | undefined;

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
  if (
    needs.runs &&
    !pre.runs &&
    !(options.runs && isRunsRuntime(options.runs))
  ) {
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
      store = storeBind!.bindStore(options, env, now, stack);
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
      signal = await signalBind!.bindSignal(options, env, now);
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

  // 4. Clocks + optional scheduler
  let clock = pre.clock;
  let schedulerTimer: ReturnType<typeof setInterval> | undefined;
  if (needs.clock) {
    const bound = await clockBind!.bindClock(options, env, now, clock);
    clock = bound.clock;
    const startScheduler = options.startScheduler ?? env !== "test";
    if (startScheduler) {
      const period = options.schedulerIntervalMs ?? 1000;
      const clockRt = clock;
      schedulerTimer = setInterval(() => {
        void clockRt.tick();
      }, period);
      schedulerTimer.unref?.();
    }
  }

  // Gate (before AI)
  let gate = pre.gate;
  if (needs.gate && !gate) {
    gate = await gateBind!.bindGate(options, now);
  }

  // 5. Channel
  let channel = pre.channel;
  if (needs.channel && !channel) {
    channel = channelBind!.bindChannel(options, now);
  }

  // 6. AI
  let ai = pre.ai;
  if (needs.ai && !ai) {
    ai = aiBind!.bindAi(options, gate, now);
  }

  // 7. Runs
  let runs = pre.runs;
  if (needs.runs) {
    if (!runs) {
      if (options.runs && isRunsRuntime(options.runs)) {
        runs = options.runs;
        if (!runs.store) await runs.open();
      } else {
        const runsOpts =
          options.runs && !isRunsRuntime(options.runs)
            ? options.runs
            : undefined;
        runs = await runsBind!.bindRuns(runsOpts);
      }
    } else if (!runs.store) {
      await runs.open();
    }
  }

  // 8. Caps — effect refs only; no element modules.
  const capabilities = mintCapabilities(options.flows ?? []);

  return {
    vault,
    store,
    signal,
    clock,
    gate,
    channel,
    ai,
    runs,
    capabilities,
    stopScheduler() {
      if (schedulerTimer !== undefined) {
        clearInterval(schedulerTimer);
        schedulerTimer = undefined;
      }
    },
    async close() {
      if (schedulerTimer !== undefined) {
        clearInterval(schedulerTimer);
        schedulerTimer = undefined;
      }
      await signal?.close();
      await vault?.close();
      await runs?.flush();
    },
  };
}

/**
 * Mint capability tokens from each flow's declared effects.
 * Tokens come from the Manifest / flow contract — never hand-passed sets.
 *
 * @param flows - Adopted flows
 */
export function mintCapabilities(
  flows: readonly AnyFlowDef[],
): Map<string, CapabilityToken> {
  const map = new Map<string, CapabilityToken>();
  for (const f of flows) {
    map.set(f.name, createCapabilityToken(f.name, f.effects));
  }
  return map;
}

function isRunsRuntime(
  value: RunsRuntime | CreateRunsRuntimeOptions,
): value is RunsRuntime {
  return (
    typeof value === "object" &&
    value !== null &&
    "record" in value &&
    typeof (value as RunsRuntime).record === "function"
  );
}
