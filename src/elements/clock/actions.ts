/**
 * Clock operator actions — pause, edit schedule, wake early (console §9.6).
 *
 * Edit is refused unless `overridable`. Wake-early sets journal `wakeAt` to
 * now and resumes the durable run immediately (Vault §9.8 cross-ref).
 */

import type { AnyFlowDef } from "../../kernel/flow.ts";
import type { JournalStore } from "../../kernel/journal.ts";
import { runDurable, type DurableResult } from "./durable.ts";
import type { CronRow, CronStore } from "./reconcile.ts";

/** Error when edit is refused. */
export class ScheduleNotOverridableError extends Error {
  override readonly name = "ScheduleNotOverridableError";
  /** Cron name that refused edit. */
  readonly cronName: string;

  /**
   * @param cronName - Cron name
   */
  constructor(cronName: string) {
    super(`clock "${cronName}" is not overridable`);
    this.cronName = cronName;
  }
}

/** Error when a cron / run is missing. */
export class ClockResourceNotFoundError extends Error {
  override readonly name = "ClockResourceNotFoundError";
  /** Resource kind. */
  readonly kind: "cron" | "run";
  /** Name or run id. */
  readonly id: string;

  /**
   * @param kind - Resource kind
   * @param id - Name or run id
   */
  constructor(kind: "cron" | "run", id: string) {
    super(`${kind} "${id}" not found`);
    this.kind = kind;
    this.id = id;
  }
}

/**
 * Pause a cron (status → `"paused"`). Scheduler skips paused rows.
 *
 * @param store - Cron store
 * @param name - Cron name
 */
export async function pauseCron(
  store: CronStore,
  name: string,
): Promise<CronRow> {
  const row = await store.get(name);
  if (!row) throw new ClockResourceNotFoundError("cron", name);
  const next: CronRow = { ...row, status: "paused" };
  await store.put(next);
  return next;
}

/** Schedule edit input (override fields). */
export interface EditScheduleInput {
  readonly name: string;
  readonly cron?: string;
  readonly every?: string;
}

/**
 * Override an overridable schedule in the Store (console §4.1 / §5).
 *
 * @param store - Cron store
 * @param input - Name + override cron and/or every
 */
export async function editSchedule(
  store: CronStore,
  input: EditScheduleInput,
): Promise<CronRow> {
  const row = await store.get(input.name);
  if (!row) throw new ClockResourceNotFoundError("cron", input.name);
  if (!row.overridable) {
    throw new ScheduleNotOverridableError(input.name);
  }
  const overrideCron =
    input.cron !== undefined ? input.cron : row.overrideCron;
  const overrideEvery =
    input.every !== undefined ? input.every : row.overrideEvery;
  const next: CronRow = {
    ...row,
    overrideCron,
    overrideEvery,
    effectiveCron: overrideCron ?? row.declaredCron,
    effectiveEvery: overrideEvery ?? row.declaredEvery,
  };
  await store.put(next);
  return next;
}

/** Options for {@link wakeEarly}. */
export interface WakeEarlyOptions {
  readonly journal: JournalStore;
  readonly runId: string;
  readonly now?: () => number;
  /**
   * Optional flow registry — when provided, resumes immediately via
   * {@link runDurable}. Without it, only `wakeAt` is advanced.
   */
  readonly resolveFlow?: (flowName: string) => AnyFlowDef | undefined;
  /** Extra fx options forwarded to resume. */
  readonly fx?: Parameters<typeof runDurable>[0]["fx"];
}

/** Outcome of wake-early. */
export interface WakeEarlyResult {
  readonly runId: string;
  readonly wakeAt: number;
  readonly resumed: boolean;
  readonly durable?: DurableResult;
}

/**
 * Wake a sleeping durable run early: set `wakeAt` to now and resume.
 *
 * @param options - Journal, run id, optional flow resolver
 */
export async function wakeEarly(
  options: WakeEarlyOptions,
): Promise<WakeEarlyResult> {
  const now = options.now ?? (() => Date.now());
  const t = now();
  const run = await options.journal.get(options.runId);
  if (!run || run.status !== "sleeping") {
    throw new ClockResourceNotFoundError("run", options.runId);
  }

  const entries = run.entries.map((e) =>
    e.kind === "sleep" && e.wakeAt === run.wakeAt
      ? { ...e, wakeAt: t }
      : e,
  );
  await options.journal.put({
    ...run,
    entries,
    wakeAt: t,
    updatedAt: t,
  });

  const flow = options.resolveFlow?.(run.flow);
  if (!flow) {
    return { runId: run.id, wakeAt: t, resumed: false };
  }

  const durable = await runDurable({
    flow,
    input: run.input,
    journalStore: options.journal,
    runId: run.id,
    now,
    fx: options.fx,
  });

  return {
    runId: run.id,
    wakeAt: t,
    resumed: true,
    durable,
  };
}
