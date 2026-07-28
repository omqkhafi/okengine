/**
 * Boot-time reconciliation — declared Manifest → Store (console §5).
 *
 * ```
 * Declared   (from the Manifest baked into the code)   ← the truth
 * Override   (in the Store, only where overridable)    ← operational drift
 * Effective  = declared + override                     ← what actually runs
 * ```
 *
 * Rows that vanished from the code are marked `orphaned`, never deleted.
 * The scheduler reads the effective state from the Store, not the code.
 */

import type { ClockDecl } from "./declare.ts";

/** Cron lifecycle status in `oke_crons`. */
export type CronStatus = "active" | "paused" | "orphaned";

/** Reconciled cron row (Store / `oke_crons`). */
export interface CronRow {
  readonly name: string;
  /** Declared cron expression from code (if any). */
  declaredCron?: string;
  /** Declared interval from code (if any). */
  declaredEvery?: string;
  /** Console override cron (only when overridable). */
  overrideCron?: string;
  /** Console override every (only when overridable). */
  overrideEvery?: string;
  /** What the scheduler uses. */
  effectiveCron?: string;
  /** What the scheduler uses for interval schedules. */
  effectiveEvery?: string;
  timezone: string;
  overridable: boolean;
  status: CronStatus;
  leaderInstanceId?: string;
  leaderLeaseUntil?: number;
  lastRunAt?: number;
  nextRunAt?: number;
  /** DST warning payload when expression+zone is ambiguous. */
  dstAmbiguity?: {
    readonly kind: "gap" | "overlap";
    readonly reason: string;
    readonly on: string;
    readonly localTime: string;
  };
}

/** Store surface for reconciled crons. */
export interface CronStore {
  /**
   * @param name - Cron name
   */
  get(name: string): Promise<CronRow | undefined>;
  /**
   * @param row - Full row
   */
  put(row: CronRow): Promise<void>;
  /** All rows currently in the store. */
  list(): Promise<readonly CronRow[]>;
  /**
   * Atomic leader-lease acquire (compare-and-set). Required so N in-process
   * instances cannot all win a race on read-modify-write.
   *
   * @param name - Cron name
   * @param instanceId - Candidate instance
   * @param now - Current epoch-ms
   * @param leaseMs - Lease TTL
   */
  acquireLease(name: string, instanceId: string, now: number, leaseMs: number): Promise<boolean>;
}

/** Result of one reconciliation pass. */
export interface ReconcileResult {
  /** Names upserted / refreshed as active. */
  readonly active: readonly string[];
  /** Names marked orphaned (present in store, absent from code). */
  readonly orphaned: readonly string[];
  /** Snapshot of every row after reconciliation. */
  readonly rows: readonly CronRow[];
}

/**
 * Reconcile declared clocks into the Store.
 *
 * - Declared schedules are upserted (`status: "active"`).
 * - Overrides are preserved when `overridable`.
 * - Store rows missing from declarations are marked `orphaned` (not deleted).
 *
 * @param declared - Clocks from the Manifest / code
 * @param store - Cron store (`oke_crons`)
 */
export async function reconcileClocks(
  declared: readonly ClockDecl[],
  store: CronStore,
): Promise<ReconcileResult> {
  const declaredByName = new Map(declared.map((d) => [d.name, d]));
  const active: string[] = [];
  const orphaned: string[] = [];

  for (const decl of declared) {
    const prev = await store.get(decl.name);
    const overrideCron =
      decl.overridable && prev?.overrideCron !== undefined ? prev.overrideCron : undefined;
    const overrideEvery =
      decl.overridable && prev?.overrideEvery !== undefined ? prev.overrideEvery : undefined;

    const row: CronRow = {
      name: decl.name,
      declaredCron: decl.cron,
      declaredEvery: decl.every,
      overrideCron,
      overrideEvery,
      effectiveCron: overrideCron ?? decl.cron,
      effectiveEvery: overrideEvery ?? decl.every,
      timezone: decl.timezone,
      overridable: decl.overridable,
      status: "active",
      leaderInstanceId: prev?.leaderInstanceId,
      leaderLeaseUntil: prev?.leaderLeaseUntil,
      lastRunAt: prev?.lastRunAt,
      nextRunAt: prev?.nextRunAt,
      dstAmbiguity: prev?.dstAmbiguity,
    };
    await store.put(row);
    active.push(decl.name);
  }

  for (const existing of await store.list()) {
    if (declaredByName.has(existing.name)) continue;
    if (existing.status === "orphaned") {
      orphaned.push(existing.name);
      continue;
    }
    const row: CronRow = {
      ...existing,
      status: "orphaned",
    };
    await store.put(row);
    orphaned.push(existing.name);
  }

  return {
    active,
    orphaned,
    rows: await store.list(),
  };
}

/**
 * Effective schedule the scheduler must read — from the Store, not code.
 *
 * @param row - Reconciled row
 */
export function effectiveSchedule(row: CronRow): {
  readonly cron?: string;
  readonly every?: string;
  readonly timezone: string;
} {
  return {
    cron: row.effectiveCron,
    every: row.effectiveEvery,
    timezone: row.timezone,
  };
}

/**
 * In-memory cron store for tests / memory clock driver.
 *
 * @param seed - Optional initial rows
 */
export function createMemoryCronStore(seed?: readonly CronRow[]): CronStore {
  const rows = new Map<string, CronRow>();
  for (const r of seed ?? []) {
    rows.set(r.name, structuredClone(r));
  }

  /** Per-name mutex chain for atomic lease acquires. */
  const locks = new Map<string, Promise<void>>();

  async function withLock<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
    const prev = locks.get(name) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    locks.set(
      name,
      prev.then(() => gate),
    );
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  return {
    async get(name) {
      const r = rows.get(name);
      return r ? structuredClone(r) : undefined;
    },
    async put(row) {
      rows.set(row.name, structuredClone(row));
    },
    async list() {
      return [...rows.values()].map((r) => structuredClone(r));
    },
    async acquireLease(name, instanceId, now, leaseMs) {
      return withLock(name, () => {
        const row = rows.get(name);
        if (!row) return false;
        const held =
          row.leaderLeaseUntil !== undefined &&
          row.leaderLeaseUntil > now &&
          row.leaderInstanceId !== undefined &&
          row.leaderInstanceId !== instanceId;
        if (held) return false;
        rows.set(name, {
          ...row,
          leaderInstanceId: instanceId,
          leaderLeaseUntil: now + leaseMs,
        });
        return true;
      });
    },
  };
}
