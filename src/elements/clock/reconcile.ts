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

import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

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
  /** Backing kind when known (`memory` · `file`). */
  readonly kind?: "memory" | "file";
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
    kind: "memory",
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

/** On-disk shape for {@link createFileCronStore}. */
interface FileCronSnapshot {
  readonly rows: CronRow[];
}

/**
 * File-backed cron store for multi-process leader election / chaos tests.
 *
 * Every mutation runs under an exclusive lock directory next to `path` so
 * two OS processes sharing the same file cannot both win a lease race.
 * Does not cache rows across calls (each op re-reads disk).
 *
 * @param path - JSON snapshot path (`{ rows: CronRow[] }`)
 */
export function createFileCronStore(path: string): CronStore {
  const lockDir = `${path}.lock`;

  async function withFileLock<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 2_000; attempt++) {
      try {
        await mkdir(lockDir);
        break;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") throw err;
        await Bun.sleep(2);
        if (attempt === 1_999) {
          throw new Error(`createFileCronStore: lock timeout on ${lockDir}`);
        }
      }
    }
    try {
      return await fn();
    } finally {
      await rm(lockDir, { recursive: true, force: true });
    }
  }

  async function loadUnlocked(): Promise<Map<string, CronRow>> {
    const map = new Map<string, CronRow>();
    const file = Bun.file(path);
    if (!(await file.exists())) return map;
    const text = await file.text();
    if (!text.trim()) return map;
    const snap = JSON.parse(text) as FileCronSnapshot;
    for (const r of snap.rows ?? []) {
      map.set(r.name, structuredClone(r));
    }
    return map;
  }

  async function flushUnlocked(map: Map<string, CronRow>): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const tmp = join(dirname(path), `.${Bun.hash(path).toString(16)}.tmp`);
    const body = JSON.stringify({ rows: [...map.values()] } satisfies FileCronSnapshot, null, 2);
    await writeFile(tmp, body, "utf8");
    await rename(tmp, path);
  }

  return {
    kind: "file",
    async get(name) {
      return withFileLock(async () => {
        const map = await loadUnlocked();
        const r = map.get(name);
        return r ? structuredClone(r) : undefined;
      });
    },
    async put(row) {
      await withFileLock(async () => {
        const map = await loadUnlocked();
        map.set(row.name, structuredClone(row));
        await flushUnlocked(map);
      });
    },
    async list() {
      return withFileLock(async () => {
        const map = await loadUnlocked();
        return [...map.values()].map((r) => structuredClone(r));
      });
    },
    async acquireLease(name, instanceId, now, leaseMs) {
      return withFileLock(async () => {
        const map = await loadUnlocked();
        const row = map.get(name);
        if (!row) return false;
        const held =
          row.leaderLeaseUntil !== undefined &&
          row.leaderLeaseUntil > now &&
          row.leaderInstanceId !== undefined &&
          row.leaderInstanceId !== instanceId;
        if (held) return false;
        map.set(name, {
          ...row,
          leaderInstanceId: instanceId,
          leaderLeaseUntil: now + leaseMs,
        });
        await flushUnlocked(map);
        return true;
      });
    },
  };
}
