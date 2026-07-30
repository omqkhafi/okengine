/**
 * Console signal inspect projection — reads the real signal bus + Manifest.
 *
 * The UI must not reimplement queue physics (console §9.4).
 */

import type { Manifest } from "../../manifest/types.ts";
import type {
  DeadLetter,
  SignalBus,
  SignalDiscardOptions,
  SignalReplayOptions,
  SignalReplayResult,
  SignalStats,
} from "../../drivers/signal-types.ts";
import type { SignalConfigRow, SignalConfigStore } from "../../elements/signal/reconcile.ts";
import { reconcileSignals } from "../../elements/signal/reconcile.ts";
import { signal as declareSignal } from "../../elements/signal/declare.ts";

/** Producer / consumer edge for the mini causality view. */
export interface SignalEndpoint {
  readonly flowId: string;
  readonly durable: boolean;
  readonly external: boolean;
  readonly peakTier: "none" | "reads" | "writes" | "emits" | "external" | "capabilities";
}

/** One row in `console.signals.list`. */
export interface ConsoleSignalRow {
  readonly name: string;
  readonly description?: string;
  readonly delivery: "once" | "broadcast" | "live";
  readonly retries: number;
  readonly deadLetterEnabled: boolean;
  readonly orphaned: boolean;
  readonly pending: number;
  readonly inflight: number;
  readonly dead: number;
  readonly delivered: number;
  readonly outboxLagMs: number | null;
  readonly connections: number;
  readonly throughputPerSec: number;
  readonly schema: unknown;
  readonly subscribers: ReadonlyArray<{
    readonly id: string;
    readonly lag: number;
    readonly errorCount: number;
  }>;
  readonly recentLive: readonly unknown[];
  readonly deadLetters: readonly DeadLetter[];
  readonly producers: readonly SignalEndpoint[];
  readonly consumers: readonly SignalEndpoint[];
  /**
   * Whether every consumer is `durable` — the most valuable line in the panel.
   * `null` when there are no consumers (or orphaned with none known).
   */
  readonly consumersDurable: boolean | null;
}

/** Options when projecting the signals list. */
export interface ProjectSignalsOptions {
  readonly manifest: Manifest | null;
  readonly config: SignalConfigStore;
  readonly bus: SignalBus | null;
  /** Wide-event rows for causal-chain links (optional). */
  readonly runs?: ReadonlyArray<{
    readonly id: string;
    readonly flow: string;
    readonly startedAt: number;
    readonly effects: ReadonlyArray<{
      readonly kind: string;
      readonly resource: string;
    }>;
  }>;
}

/**
 * Reconcile Manifest signals into the config store, then project operator rows.
 *
 * @param options - Manifest, config store, live bus
 */
export async function projectSignalsList(
  options: ProjectSignalsOptions,
): Promise<readonly ConsoleSignalRow[]> {
  const declared = Object.entries(options.manifest?.signals ?? {}).map(([name, s]) =>
    declareSignal(name, {
      delivery: s.delivery,
      retries: s.retries,
      deadLetter: s.deadLetter,
      schema: s.schema,
      optional: s.optional,
    }),
  );
  const reconciled = await reconcileSignals(declared, options.config);
  const statsByName = new Map<string, SignalStats>();
  if (options.bus) {
    for (const s of await options.bus.inspect()) {
      statsByName.set(s.signal, s);
    }
  }

  const flows = options.manifest?.flows ?? {};
  const rows: ConsoleSignalRow[] = [];

  for (const cfg of reconciled.rows) {
    const stats = statsByName.get(cfg.name);
    const producers = producersOf(cfg.name, flows);
    const consumers = consumersOf(cfg.name, flows);
    const consumersDurable = consumers.length === 0 ? null : consumers.every((c) => c.durable);

    // Attach causal run ids onto dead letters when a matching emit exists.
    const deadLetters = (stats?.deadLetters ?? []).map((dl) =>
      withCause(dl, cfg.name, options.runs),
    );

    const description = options.manifest?.signals?.[cfg.name]?.description;
    rows.push({
      name: cfg.name,
      ...(description !== undefined ? { description } : {}),
      delivery: cfg.delivery,
      retries: stats?.retries ?? cfg.retries,
      deadLetterEnabled: stats?.deadLetterEnabled ?? cfg.deadLetter,
      orphaned: cfg.status === "orphaned",
      pending: stats?.pending ?? 0,
      inflight: stats?.inflight ?? 0,
      dead: stats?.dead ?? deadLetters.length,
      delivered: stats?.delivered ?? 0,
      outboxLagMs: stats?.outboxLagMs ?? null,
      connections: stats?.connections ?? 0,
      throughputPerSec: stats?.throughputPerSec ?? 0,
      schema: stats?.schema ?? cfg.schema,
      subscribers: stats?.subscribers ?? [],
      recentLive: stats?.recentLive ?? [],
      deadLetters,
      producers,
      consumers,
      consumersDurable,
    });
  }

  // Bus-only names (declared at runtime but missing from Manifest history)
  // still surface — they become active rows via reconciliation on next Manifest
  // bake; until then list them from inspect.
  for (const [name, stats] of statsByName) {
    if (rows.some((r) => r.name === name)) continue;
    const producers = producersOf(name, flows);
    const consumers = consumersOf(name, flows);
    const description = options.manifest?.signals?.[name]?.description;
    rows.push({
      name,
      ...(description !== undefined ? { description } : {}),
      delivery: stats.delivery,
      retries: stats.retries,
      deadLetterEnabled: stats.deadLetterEnabled,
      orphaned: false,
      pending: stats.pending,
      inflight: stats.inflight,
      dead: stats.dead,
      delivered: stats.delivered,
      outboxLagMs: stats.outboxLagMs,
      connections: stats.connections,
      throughputPerSec: stats.throughputPerSec,
      schema: stats.schema,
      subscribers: [...stats.subscribers],
      recentLive: [...stats.recentLive],
      deadLetters: stats.deadLetters.map((dl) => withCause(dl, name, options.runs)),
      producers,
      consumers,
      consumersDurable: consumers.length === 0 ? null : consumers.every((c) => c.durable),
    });
  }

  return rows.sort((a, b) => {
    const order = { once: 0, broadcast: 1, live: 2 } as const;
    const d = order[a.delivery] - order[b.delivery];
    return d !== 0 ? d : a.name.localeCompare(b.name);
  });
}

/**
 * Replay via the real bus (rate-limited).
 *
 * @param bus - Signal bus
 * @param options - Replay options
 */
export async function replayViaBus(
  bus: SignalBus,
  options: SignalReplayOptions,
): Promise<SignalReplayResult> {
  return bus.replay(options);
}

/**
 * Discard dead letters via the real bus.
 *
 * @param bus - Signal bus
 * @param options - Discard options
 */
export async function discardViaBus(
  bus: SignalBus,
  options: SignalDiscardOptions,
): Promise<{ readonly discarded: number }> {
  return bus.discard(options);
}

function producersOf(signalName: string, flows: NonNullable<Manifest["flows"]>): SignalEndpoint[] {
  const out: SignalEndpoint[] = [];
  for (const [flowId, flow] of Object.entries(flows)) {
    if (flow.effects?.emits?.includes(signalName)) {
      out.push(endpoint(flowId, flow));
    }
  }
  return out;
}

function consumersOf(signalName: string, flows: NonNullable<Manifest["flows"]>): SignalEndpoint[] {
  const out: SignalEndpoint[] = [];
  for (const [flowId, flow] of Object.entries(flows)) {
    if (flow.trigger?.signal === signalName) {
      out.push(endpoint(flowId, flow));
    }
  }
  return out;
}

function endpoint(flowId: string, flow: NonNullable<Manifest["flows"]>[string]): SignalEndpoint {
  return {
    flowId,
    durable: flow.durable === true,
    external: peakTierOf(flow) === "external",
    peakTier: peakTierOf(flow),
  };
}

function peakTierOf(flow: NonNullable<Manifest["flows"]>[string]): SignalEndpoint["peakTier"] {
  const e = flow.effects;
  if (!e) return "none";
  if ((e.sends?.length ?? 0) > 0 || (e.asks?.length ?? 0) > 0) return "external";
  if ((e.secrets?.length ?? 0) > 0) return "capabilities";
  if ((e.emits?.length ?? 0) > 0) return "emits";
  if ((e.writes?.length ?? 0) > 0) return "writes";
  if ((e.reads?.length ?? 0) > 0) return "reads";
  return "none";
}

function withCause(
  dl: DeadLetter,
  signalName: string,
  runs: ProjectSignalsOptions["runs"],
): DeadLetter & { readonly causeRunId?: string; readonly causeFlow?: string } {
  if (!runs || runs.length === 0) return dl;
  const match = runs.find((r) =>
    r.effects.some((e) => e.kind === "emit" && e.resource === signalName),
  );
  if (!match) return dl;
  return {
    ...dl,
    causeRunId: match.id,
    causeFlow: match.flow,
  };
}

/** Seed helper — expose config row type for tests. */
export type { SignalConfigRow };
