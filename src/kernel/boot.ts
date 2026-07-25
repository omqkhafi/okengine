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
 * The scheduler reads the effective state from the Store after reconciliation,
 * never the code directly (console §5).
 */

import {
  createAiRuntime,
  type AiRuntime,
  type CreateAiRuntimeOptions,
} from "../elements/ai.ts";
import {
  createChannelRuntime,
  type ChannelRuntime,
  type CreateChannelRuntimeOptions,
} from "../elements/channel.ts";
import {
  clock as declareClock,
  createClockRuntime,
  createTestClockRuntime,
  type ClockDecl,
  type ClockRuntime,
} from "../elements/clock.ts";
import {
  createGateRuntime,
  type GateDecl,
  type GateRuntime,
} from "../elements/gate.ts";
import {
  createSignalRuntime,
  type SignalDecl,
  type SignalRuntime,
} from "../elements/signal.ts";
import {
  createStoreRuntime,
  type StoreDecl,
  type StoreRuntime,
} from "../elements/store.ts";
import {
  createVaultRuntime,
  type CreateVaultRuntimeOptions,
  type VaultRuntime,
  type VaultSecretDecl,
} from "../elements/vault.ts";
import {
  memoryDrivers,
  memorySignalDriver,
  memoryVaultDriver,
  openConsoleChannel,
  mockAiDriver,
} from "../drivers/index.ts";
import {
  resolveDriverId,
  type ConfigEnv,
  type OkeConfig,
} from "../config/index.ts";
import {
  createRunsRuntime,
  memoryRunsDriver,
  type CreateRunsRuntimeOptions,
  type RunsRuntime,
} from "../runs/index.ts";
import {
  createCapabilityToken,
  type CapabilityToken,
} from "./capability.ts";
import type { AnyFlowDef } from "./flow.ts";
import type { Binding } from "./on.ts";
import type { Effects } from "../manifest/types.ts";

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
  /** Active environment (defaults to `dev`). */
  readonly env?: ConfigEnv;
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

/**
 * Run the ordered boot sequence. Fails fast — a missing secret throws
 * before store/signal/… open, so no request can be served.
 *
 * @param options - Declarations, config, pre-built runtimes
 */
export async function bootApplication(
  options: BootOptions = {},
): Promise<BootResult> {
  const env: ConfigEnv = options.env ?? "dev";
  const pre = options.elements ?? {};
  const now = options.now ?? (() => Date.now());

  // 1. Vault boot — resolve every declared secret; list all gaps at once.
  const vaultSecrets =
    options.vault?.secrets ?? options.secrets ?? [];
  let vault = pre.vault;
  if (!vault && vaultSecrets.length > 0) {
    vault = createVaultRuntime({
      secrets: vaultSecrets,
      chain: options.vault?.chain ?? [
        {
          driver: memoryVaultDriver,
          options: { secrets: {} },
        },
      ],
      allowDevFallbacks:
        options.vault?.allowDevFallbacks ?? env !== "prod",
    });
  }
  if (vault && !vault.booted) {
    await vault.boot();
  }

  // 2. Bind store drivers per environment; open connections.
  let store = pre.store;
  if (!store) {
    const sqlId =
      resolveDriverId(options.config?.drivers?.store?.sql, env) ?? "memory";
    const kvId =
      resolveDriverId(options.config?.drivers?.store?.kv, env) ?? "memory";
    // Protocol ids → memory bundle for test/dev when not otherwise injected.
    void sqlId;
    void kvId;
    store = createStoreRuntime({
      drivers: {
        sql: memoryDrivers.sql,
        kv: memoryDrivers.kv,
        files: memoryDrivers.files,
        index: memoryDrivers.index,
      },
      now,
    });
  }
  for (const decl of options.stores ?? []) {
    store.register?.(decl);
  }

  // 3. Register signals; start consumers.
  let signal = pre.signal;
  if (!signal) {
    const signalId =
      resolveDriverId(options.config?.drivers?.signal, env) ?? "memory";
    void signalId;
    signal = createSignalRuntime({
      driver: memorySignalDriver,
      now,
    });
  }
  for (const decl of options.signals ?? []) {
    signal.register(decl);
  }
  // Also register signal-as-trigger names from bindings.
  for (const b of options.bindings ?? []) {
    if (b.trigger.kind === "signal") {
      if (!signal.declarations.has(b.trigger.name)) {
        // Minimal decl so the bus knows the name; optional to avoid orphan fail.
        signal.register({
          name: b.trigger.name,
          delivery: "once",
          retries: 3,
          deadLetter: true,
          optional: true,
        });
      }
    }
  }
  const bus = await signal.start();

  if (options.onSignal) {
    const handler = options.onSignal;
    const seen = new Set<string>();
    for (const b of options.bindings ?? []) {
      if (b.trigger.kind !== "signal") continue;
      const name = b.trigger.name;
      if (seen.has(name)) continue;
      seen.add(name);
      await bus.subscribe(name, `oke:${name}`, async (msg) => {
        await handler(name, msg.payload);
      });
    }
  }

  // 4. Reconcile clocks into the store; start scheduler with leader election.
  const clockDriver =
    resolveDriverId(options.config?.drivers?.clock, env) ??
    (env === "test" ? "frozen" : "memory");
  let clock = pre.clock;
  if (!clock) {
    clock =
      clockDriver === "frozen" || env === "test"
        ? createTestClockRuntime(now(), { instanceId: options.instanceId })
        : createClockRuntime({ instanceId: options.instanceId, now });
  }

  const clockDecls = new Map<string, ClockDecl>();
  for (const c of options.clocks ?? []) {
    clockDecls.set(c.name, c);
  }
  // every("1h") bindings → named clocks the scheduler can fire.
  for (const b of options.bindings ?? []) {
    if (b.trigger.kind === "every" && !clockDecls.has(b.trigger.interval)) {
      clockDecls.set(
        b.trigger.interval,
        declareClock(b.trigger.interval, { every: b.trigger.interval }),
      );
    }
  }
  for (const decl of clockDecls.values()) {
    clock.register(decl);
  }
  await clock.reconcile();

  if (options.onCronFire) {
    const fire = options.onCronFire;
    for (const name of clockDecls.keys()) {
      clock.onCron(name, async () => {
        await fire(name);
      });
    }
  }

  // Default ON outside test — a declared every()/cron must fire with zero
  // further application calls (Clock element's core promise).
  const startScheduler =
    options.startScheduler ?? (env !== "test");
  let schedulerTimer: ReturnType<typeof setInterval> | undefined;
  if (startScheduler) {
    const period = options.schedulerIntervalMs ?? 1000;
    schedulerTimer = setInterval(() => {
      void clock!.tick();
    }, period);
    // Don't keep the process alive solely for the scheduler in tests.
    schedulerTimer.unref?.();
  }

  // Gate runtime (needs kv from store drivers) — used by the request
  // pipeline and AI agents. Constructed before channel/AI bind.
  let gate = pre.gate;
  if (!gate) {
    const kvNs = await memoryDrivers.kv.open({ name: "oke:gates" });
    gate = createGateRuntime({
      gates: options.gates ?? [],
      kv: kvNs,
      now,
    });
  }

  // 5. Bind channel runtime.
  let channel = pre.channel;
  if (!channel) {
    channel = createChannelRuntime({
      ...(options.channel ?? {}),
      drivers: options.channel?.drivers ?? [openConsoleChannel()],
      now,
    });
  }

  // 6. Bind AI runtime (shares the gate runtime for agent tool checks).
  let ai = pre.ai;
  if (!ai) {
    ai = createAiRuntime({
      ...(options.ai ?? {}),
      defaultDriver: options.ai?.defaultDriver ?? mockAiDriver,
      gates: options.ai?.gates ?? gate,
      now,
    });
  }

  // 7. Open the runs store.
  let runs = pre.runs;
  if (!runs) {
    if (options.runs && isRunsRuntime(options.runs)) {
      runs = options.runs;
    } else {
      const runsOpts =
        options.runs && !isRunsRuntime(options.runs)
          ? options.runs
          : undefined;
      runs = createRunsRuntime({
        driver: runsOpts?.driver ?? memoryRunsDriver,
        ...(runsOpts ?? {}),
      });
    }
  }
  if (runs && !runs.store) {
    await runs.open();
  }

  // 8. Mint per-flow capability tokens from declared effects (Manifest).
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
