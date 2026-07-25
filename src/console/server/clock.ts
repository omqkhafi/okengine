/**
 * Console Clock projection — ClockRuntime + journal (console §9.6).
 *
 * Reuses reconciliation, DST detection, lease fields, and journal sleeps.
 * Does not reimplement leader election or DST math in the UI layer.
 */

import type { AnyFlowDef } from "../../kernel/flow.ts";
import type { JournalRun, JournalStore } from "../../kernel/journal.ts";
import type { Manifest } from "../../manifest/types.ts";
import {
  clock as declareClock,
  cronHealth,
  createClockRuntime,
  editSchedule,
  nextOccurrences,
  pauseCron,
  wakeEarly,
  type ClockRuntime,
  type CronHealth,
  type CronRow,
  type EditScheduleInput,
  type WakeEarlyResult,
  ClockResourceNotFoundError,
  ScheduleNotOverridableError,
} from "../../elements/clock.ts";

/** One cron row in `console.clock.list`. */
export interface ConsoleClockRow {
  readonly name: string;
  readonly status: CronRow["status"];
  readonly timezone: string;
  readonly overridable: boolean;
  readonly declaredCron?: string;
  readonly declaredEvery?: string;
  readonly effectiveCron?: string;
  readonly effectiveEvery?: string;
  readonly lastRunAt?: number;
  readonly nextRunAt?: number;
  readonly health: CronHealth;
  readonly dstAmbiguity: CronRow["dstAmbiguity"] | null;
  /** Bound flow(s) have external effects (channels / AI). */
  readonly external: boolean;
  readonly flowIds: readonly string[];
}

/** One sleeping durable run in the waiting-on list. */
export interface ConsoleWaitingOnRow {
  readonly runId: string;
  readonly flow: string;
  readonly label: string;
  readonly wakeAt: number;
  readonly wakeInMs: number;
  /** Last completed step name, if any. */
  readonly step: string | null;
}

/** Aggregate counts by sleep label. */
export interface WaitingOnCount {
  readonly label: string;
  readonly count: number;
}

/** Forward timeline event (next 24h). */
export interface ConsoleTimelineEvent {
  readonly at: number;
  readonly kind: "cron" | "wake";
  readonly name: string;
  readonly meta?: string;
}

/** Full list response for the Clock panel. */
export interface ConsoleClockList {
  readonly now: number;
  readonly crons: readonly ConsoleClockRow[];
  readonly waitingOn: readonly ConsoleWaitingOnRow[];
  readonly waitingOnCounts: readonly WaitingOnCount[];
  readonly timeline: readonly ConsoleTimelineEvent[];
}

/** Options when projecting the clock list. */
export interface ProjectClocksOptions {
  readonly manifest: Manifest | null;
  readonly runtime: ClockRuntime | null;
  readonly journal?: JournalStore | null;
  readonly now?: () => number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Reconcile Manifest clocks (when runtime present) and project operator rows.
 *
 * @param options - Manifest, runtime, journal
 */
export async function projectClocksList(
  options: ProjectClocksOptions,
): Promise<ConsoleClockList> {
  const now = (options.now ?? (() => Date.now()))();
  const until = now + DAY_MS;

  if (options.runtime) {
    await options.runtime.reconcile();
  }

  const rows = options.runtime
    ? await options.runtime.store.list()
    : rowsFromManifest(options.manifest);

  const flows = options.manifest?.flows ?? {};
  const crons: ConsoleClockRow[] = rows
    .map((row) => {
      const flowIds = flowIdsForCronRow(row, options.manifest);
      const external = flowIds.some((id) => isExternal(flows[id]));
      return {
        name: row.name,
        status: row.status,
        timezone: row.timezone,
        overridable: row.overridable,
        declaredCron: row.declaredCron,
        declaredEvery: row.declaredEvery,
        effectiveCron: row.effectiveCron,
        effectiveEvery: row.effectiveEvery,
        lastRunAt: row.lastRunAt,
        nextRunAt: row.nextRunAt,
        health: cronHealth(row, now),
        dstAmbiguity: row.dstAmbiguity ?? null,
        external,
        flowIds,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const waitingOn = projectWaitingOn(
    options.journal ? await options.journal.list() : [],
    now,
  );
  const waitingOnCounts = aggregateWaitingOn(waitingOn);

  const timeline: ConsoleTimelineEvent[] = [];
  for (const row of rows) {
    if (row.status === "orphaned") continue;
    for (const at of nextOccurrences(row, now, until)) {
      timeline.push({
        at,
        kind: "cron",
        name: row.name,
        meta: row.effectiveCron ?? row.effectiveEvery,
      });
    }
  }
  for (const w of waitingOn) {
    if (w.wakeAt >= now && w.wakeAt < until) {
      timeline.push({
        at: w.wakeAt,
        kind: "wake",
        name: w.label || w.flow,
        meta: w.runId,
      });
    }
  }
  timeline.sort((a, b) => a.at - b.at || a.name.localeCompare(b.name));

  return { now, crons, waitingOn, waitingOnCounts, timeline };
}

/**
 * Project sleeping journal runs into waiting-on rows.
 *
 * @param runs - Journal runs
 * @param now - Clock
 */
export function projectWaitingOn(
  runs: readonly JournalRun[],
  now: number,
): readonly ConsoleWaitingOnRow[] {
  const out: ConsoleWaitingOnRow[] = [];
  for (const r of runs) {
    if (r.status !== "sleeping" || r.wakeAt == null) continue;
    const sleep = [...r.entries].reverse().find((e) => e.kind === "sleep");
    const step = [...r.entries].reverse().find((e) => e.kind === "step");
    out.push({
      runId: r.id,
      flow: r.flow,
      label: sleep && sleep.kind === "sleep" ? sleep.label : "",
      wakeAt: r.wakeAt,
      wakeInMs: Math.max(0, r.wakeAt - now),
      step: step && step.kind === "step" ? step.name : null,
    });
  }
  return out.sort((a, b) => a.wakeAt - b.wakeAt || a.runId.localeCompare(b.runId));
}

/**
 * Aggregate waiting-on rows by sleep label.
 *
 * @param rows - Waiting-on rows
 */
export function aggregateWaitingOn(
  rows: readonly ConsoleWaitingOnRow[],
): readonly WaitingOnCount[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const label = r.label || "(unlabelled)";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Run a cron now via the real runtime (lease-gated).
 *
 * @param runtime - Clock runtime
 * @param name - Cron name
 */
export async function runCronNow(
  runtime: ClockRuntime,
  name: string,
): Promise<{ readonly ran: boolean }> {
  const row = await runtime.store.get(name);
  if (!row) throw new ClockResourceNotFoundError("cron", name);
  const ran = await runtime.runNow(name);
  return { ran };
}

/**
 * Pause a cron via the Store.
 *
 * @param runtime - Clock runtime
 * @param name - Cron name
 */
export async function pauseCronNow(
  runtime: ClockRuntime,
  name: string,
): Promise<CronRow> {
  return pauseCron(runtime.store, name);
}

/**
 * Edit an overridable schedule.
 *
 * @param runtime - Clock runtime
 * @param input - Name + override fields
 */
export async function editCronSchedule(
  runtime: ClockRuntime,
  input: EditScheduleInput,
): Promise<CronRow> {
  return editSchedule(runtime.store, input);
}

/**
 * Wake a sleeping durable run early and resume when a flow resolver is given.
 *
 * @param journal - Journal store
 * @param runId - Run id
 * @param options - Clock + optional flow resolver
 */
export async function wakeEarlyNow(
  journal: JournalStore,
  runId: string,
  options: {
    readonly now?: () => number;
    readonly resolveFlow?: (flowName: string) => AnyFlowDef | undefined;
  } = {},
): Promise<WakeEarlyResult> {
  return wakeEarly({
    journal,
    runId,
    now: options.now,
    resolveFlow: options.resolveFlow,
  });
}

export {
  ClockResourceNotFoundError,
  ScheduleNotOverridableError,
};

/**
 * Bind a ClockRuntime from Manifest clocks (memory store).
 *
 * @param manifest - Manifest
 * @param options - Instance id / clock
 */
export function createManifestClockRuntime(
  manifest: Manifest | null,
  options: {
    readonly instanceId?: string;
    readonly now?: () => number;
  } = {},
): ClockRuntime {
  const runtime = createClockRuntime({
    instanceId: options.instanceId ?? "console",
    now: options.now,
  });
  for (const [name, c] of Object.entries(manifest?.clocks ?? {})) {
    runtime.register(
      declareClock(name, {
        cron: c.cron,
        every: c.every,
        timezone: c.timezone,
        overridable: c.overridable,
      }),
    );
  }
  // Also register clocks implied by flow triggers (interval / cron names).
  for (const [flowId, flow] of Object.entries(manifest?.flows ?? {})) {
    const every = flow.trigger?.every;
    const cron = flow.trigger?.cron;
    if (!every && !cron) continue;
    const name = cronNameForFlow(flowId, every, cron);
    if (runtime.declarations.has(name)) continue;
    runtime.register(
      declareClock(name, {
        cron,
        every,
        overridable: false,
      }),
    );
  }
  return runtime;
}

function cronNameForFlow(
  flowId: string,
  every: string | undefined,
  cron: string | undefined,
): string {
  if (every) return `every:${every}:${flowId}`;
  return `cron:${cron}:${flowId}`;
}

function rowsFromManifest(manifest: Manifest | null): CronRow[] {
  const out: CronRow[] = [];
  for (const [name, c] of Object.entries(manifest?.clocks ?? {})) {
    out.push({
      name,
      declaredCron: c.cron,
      declaredEvery: c.every,
      effectiveCron: c.cron,
      effectiveEvery: c.every,
      timezone: c.timezone ?? "UTC",
      overridable: c.overridable ?? false,
      status: "active",
    });
  }
  return out;
}

/**
 * Link flow ids to a cron by name or schedule equality.
 *
 * @param row - Cron row
 * @param manifest - Manifest
 */
export function flowIdsForCronRow(
  row: CronRow,
  manifest: Manifest | null,
): readonly string[] {
  if (!manifest?.flows) return [];
  const out = new Set<string>();
  for (const [flowId, flow] of Object.entries(manifest.flows)) {
    const every = flow.trigger?.every;
    const cron = flow.trigger?.cron;
    if (!every && !cron) continue;
    if (
      flowId === row.name ||
      flowId.endsWith(`.${row.name}`) ||
      cronNameForFlow(flowId, every, cron) === row.name ||
      (cron &&
        (cron === row.effectiveCron || cron === row.declaredCron)) ||
      (every &&
        (every === row.effectiveEvery || every === row.declaredEvery))
    ) {
      out.add(flowId);
    }
  }
  return [...out].sort();
}

function isExternal(
  flow: NonNullable<Manifest["flows"]>[string] | undefined,
): boolean {
  if (!flow?.effects) return false;
  const e = flow.effects;
  return (e.sends?.length ?? 0) > 0 || (e.asks?.length ?? 0) > 0;
}
