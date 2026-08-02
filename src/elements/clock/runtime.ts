/**
 * Clock runtime — reconciliation, leader-elected scheduling, time travel.
 *
 * The scheduler reads the effective state from the Store after boot
 * reconciliation (console §5). Crons leader-elect so N instances do not
 * duplicate (unified-theory · Clone).
 */

import type { ClockDecl } from "./declare.ts";
import { detectDstAmbiguity } from "./dst.ts";
import { parseDurationMs } from "./duration.ts";
import { tryAcquireLease } from "./leader.ts";
import {
  createMemoryCronStore,
  effectiveSchedule,
  reconcileClocks,
  type CronRow,
  type CronStore,
  type ReconcileResult,
} from "./reconcile.ts";
import { createTimeTravel, type TimeTravel } from "./time-travel.ts";

/** Handler invoked when a cron fires. */
export type CronHandler = (cron: CronRow) => void | Promise<void>;

/** Options for {@link createClockRuntime}. */
export interface CreateClockRuntimeOptions {
  /** This instance's id (leader election). */
  readonly instanceId?: string;
  /** Cron store (`oke_crons`). Defaults to in-memory. */
  readonly store?: CronStore;
  /** Injectable clock (frozen / time-travel in tests). */
  readonly now?: () => number;
  /** Leader lease TTL (default 30s). */
  readonly leaseMs?: number;
  /**
   * Optional frozen clock — when set, {@link ClockRuntime.advance} moves it
   * and {@link ClockRuntime.now} reads it.
   */
  readonly timeTravel?: TimeTravel;
}

/** Clock runtime. */
export interface ClockRuntime {
  /**
   * Effective driver id selected at construction
   * (`memory` · `file` · `frozen`).
   */
  readonly driverId: "memory" | "file" | "frozen";
  /** Instance id used for leases. */
  readonly instanceId: string;
  /** Cron store the scheduler reads. */
  readonly store: CronStore;
  /** Current epoch-ms. */
  now(): number;
  /**
   * Advance a time-travel clock (no-op when not frozen).
   *
   * @param by - Duration string or ms
   */
  advance(by: string | number): number;
  /**
   * Register a declared clock (pre-reconcile).
   *
   * @param decl - From {@link clock}
   */
  register(decl: ClockDecl): void;
  /** Registered declarations. */
  readonly declarations: ReadonlyMap<string, ClockDecl>;
  /**
   * Reconcile declarations into the Store. Marks removed crons orphaned.
   */
  reconcile(): Promise<ReconcileResult>;
  /**
   * Attach a handler for a cron name (reads effective schedule from Store).
   *
   * @param name - Cron name
   * @param handler - Fired when due and this instance holds the lease
   */
  onCron(name: string, handler: CronHandler): void;
  /**
   * Tick the scheduler once: for each active non-orphaned cron that is due,
   * try to acquire the lease and run the handler at most once across instances.
   *
   * @param until - Optional horizon; defaults to `now()`
   */
  tick(until?: number): Promise<{ readonly ran: readonly string[] }>;
  /**
   * Run a named cron now (still requires the lease — three instances → one run).
   *
   * @param name - Cron name
   */
  runNow(name: string): Promise<boolean>;
  /**
   * DST ambiguity for a store row (expression + zone).
   *
   * @param name - Cron name
   */
  dstAmbiguity(name: string): Promise<ReturnType<typeof detectDstAmbiguity>>;
}

/**
 * Create a clock runtime.
 *
 * @param options - Instance id, store, clock
 */
export function createClockRuntime(options: CreateClockRuntimeOptions = {}): ClockRuntime {
  const timeTravel = options.timeTravel;
  const now = (): number => (timeTravel ? timeTravel.now() : (options.now ?? (() => Date.now()))());
  const store = options.store ?? createMemoryCronStore();
  const instanceId = options.instanceId ?? crypto.randomUUID();
  const leaseMs = options.leaseMs ?? 30_000;
  const declarations = new Map<string, ClockDecl>();
  const handlers = new Map<string, CronHandler>();
  const driverId: ClockRuntime["driverId"] = timeTravel
    ? "frozen"
    : store.kind === "file"
      ? "file"
      : "memory";

  async function fire(name: string): Promise<boolean> {
    const row = await store.get(name);
    if (!row || row.status === "orphaned" || row.status === "paused") {
      return false;
    }
    const t = now();
    // One execution per lease window — even the leader cannot double-fire.
    if (
      row.leaderLeaseUntil !== undefined &&
      row.leaderLeaseUntil > t &&
      row.lastRunAt !== undefined
    ) {
      const leaseStart = row.leaderLeaseUntil - leaseMs;
      if (row.lastRunAt >= leaseStart) return false;
    }
    const acquired = await tryAcquireLease({
      name,
      instanceId,
      now: t,
      leaseMs,
      store,
    });
    if (!acquired) return false;

    const handler = handlers.get(name);
    const fresh = (await store.get(name))!;
    if (handler) await handler(fresh);
    await store.put({
      ...fresh,
      lastRunAt: now(),
    });
    return true;
  }

  function isDue(row: CronRow, until: number): boolean {
    if (row.status !== "active") return false;
    const sched = effectiveSchedule(row);
    if (sched.every) {
      const interval = parseDurationMs(sched.every);
      if (interval <= 0) return false;
      if (row.lastRunAt === undefined) return true;
      return row.lastRunAt + interval <= until;
    }
    if (sched.cron) {
      // Interval-free cron: due when nextRunAt is unset or <= until.
      // Tests drive `runNow` / first tick; production would compute next fire.
      if (row.nextRunAt !== undefined) return row.nextRunAt <= until;
      return row.lastRunAt === undefined;
    }
    return false;
  }

  const runtime: ClockRuntime = {
    driverId,
    instanceId,
    store,
    declarations,
    now,
    advance(by) {
      if (!timeTravel) {
        throw new Error("clock.advance requires a time-travel harness");
      }
      return timeTravel.advance(by);
    },
    register(decl) {
      declarations.set(decl.name, decl);
    },
    async reconcile() {
      const result = await reconcileClocks([...declarations.values()], store);
      // Attach DST warnings for active cron expressions.
      for (const row of result.rows) {
        if (row.status !== "active") continue;
        const cronExpr = row.effectiveCron;
        if (!cronExpr) continue;
        const amb = detectDstAmbiguity(cronExpr, row.timezone, now());
        if (amb) {
          await store.put({
            ...row,
            dstAmbiguity: {
              kind: amb.kind,
              reason: amb.reason,
              on: amb.on,
              localTime: amb.localTime,
            },
          });
        }
      }
      return {
        ...result,
        rows: await store.list(),
      };
    },
    onCron(name, handler) {
      handlers.set(name, handler);
    },
    async tick(until) {
      const horizon = until ?? now();
      const ran: string[] = [];
      for (const row of await store.list()) {
        if (!isDue(row, horizon)) continue;
        if (await fire(row.name)) ran.push(row.name);
      }
      return { ran };
    },
    async runNow(name) {
      return fire(name);
    },
    async dstAmbiguity(name) {
      const row = await store.get(name);
      if (!row?.effectiveCron) return null;
      return detectDstAmbiguity(row.effectiveCron, row.timezone, now());
    },
  };

  return runtime;
}

/**
 * Create a clock runtime with a frozen time-travel harness.
 *
 * @param start - Initial epoch-ms
 * @param options - Extra runtime options
 */
export function createTestClockRuntime(
  start = 0,
  options: Omit<CreateClockRuntimeOptions, "timeTravel" | "now"> = {},
): ClockRuntime & { readonly timeTravel: TimeTravel } {
  const timeTravel = createTimeTravel(start);
  const runtime = createClockRuntime({ ...options, timeTravel });
  return Object.assign(runtime, { timeTravel });
}
