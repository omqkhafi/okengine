/**
 * Fleet instance registry — one row per process, TTL liveness, no sweeper.
 *
 * Alive ⇔ `leaseExpiresAt > now`. Each process UPSERTs only its own row.
 * SIGKILL leaves a stale row until TTL (same physics as Clock / Journal).
 */

import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ConfigEnv } from "../config/index.ts";
import type { CronStore } from "../elements/clock/reconcile.ts";
import type { JournalStore } from "./journal.ts";

/** Heartbeat write interval — ride the 1s scheduler, write every 5s. */
export const INSTANCE_HEARTBEAT_MS = 5_000;

/** Presence TTL — matches Clock / Journal / Vault rotate (30s). */
export const INSTANCE_LEASE_MS = 30_000;

/** One process row in `oke_instances`. */
export interface InstanceRow {
  readonly id: string;
  readonly startedAt: number;
  readonly heartbeatAt: number;
  readonly leaseExpiresAt: number;
  readonly env: ConfigEnv;
  readonly pid?: number;
}

/** Durable store for {@link InstanceRow} (own-row UPSERT, not a claim). */
export interface InstanceStore {
  readonly kind: "memory" | "file" | "postgres";
  /**
   * Insert or refresh this process's row. Never overwrites `startedAt`.
   *
   * @param row - Full row
   */
  upsert(row: InstanceRow): Promise<void>;
  /**
   * @param id - Instance id
   */
  get(id: string): Promise<InstanceRow | undefined>;
  /** Every row, including expired (readers filter). */
  list(): Promise<readonly InstanceRow[]>;
  /**
   * Rows whose lease has not expired.
   *
   * @param now - Epoch-ms
   */
  listAlive(now: number): Promise<readonly InstanceRow[]>;
  /**
   * Delete this process's row (graceful release).
   *
   * @param id - Instance id
   */
  remove(id: string): Promise<void>;
  /** Close the backing connection when the driver owns one. */
  close?(): Promise<void>;
}

/** Clock lease currently held by an instance. */
export interface InstanceClockLease {
  readonly name: string;
  readonly leaseUntil: number;
}

/** Journal run lease currently held by an instance. */
export interface InstanceJournalLease {
  readonly runId: string;
  readonly flow: string;
  readonly leaseUntil: number;
}

/** One live instance + read-time lease snapshot. */
export interface InstanceDetail {
  readonly id: string;
  readonly startedAt: number;
  readonly heartbeatAt: number;
  readonly leaseExpiresAt: number;
  readonly env: ConfigEnv;
  readonly pid?: number;
  readonly clock: readonly InstanceClockLease[];
  readonly journal: readonly InstanceJournalLease[];
}

/** Registry unbound — not a zero count. */
export type InstancesListEmpty = {
  readonly kind: "empty";
};

/** Live fleet snapshot. */
export type InstancesListFleet = {
  readonly kind: "fleet";
  readonly now: number;
  readonly alive: number;
  readonly instances: readonly InstanceDetail[];
};

/** Console / operator projection of the fleet. */
export type InstancesList = InstancesListEmpty | InstancesListFleet;

/** Options for {@link projectInstancesList}. */
export interface ProjectInstancesListOptions {
  readonly store: InstanceStore | null | undefined;
  readonly clock?: CronStore | null;
  readonly journal?: JournalStore | null;
  readonly now?: () => number;
}

/**
 * Project live instances + Clock / Journal leases joined by instance id.
 *
 * Unbound store → `{ kind: "empty" }` (never `{ alive: 0 }`).
 *
 * @param options - Registry + optional join stores
 */
export async function projectInstancesList(
  options: ProjectInstancesListOptions,
): Promise<InstancesList> {
  if (!options.store) return { kind: "empty" };
  const now = (options.now ?? (() => Date.now()))();
  const alive = await options.store.listAlive(now);
  const crons = options.clock ? await options.clock.list() : [];
  const runs = options.journal ? await options.journal.list() : [];

  const instances: InstanceDetail[] = alive.map((row) => {
    const clock: InstanceClockLease[] = [];
    for (const cron of crons) {
      if (cron.leaderInstanceId === row.id && (cron.leaderLeaseUntil ?? 0) > now) {
        clock.push({ name: cron.name, leaseUntil: cron.leaderLeaseUntil! });
      }
    }
    const journal: InstanceJournalLease[] = [];
    for (const run of runs) {
      if (run.lockedBy === row.id && (run.leaseExpiresAt ?? 0) > now) {
        journal.push({ runId: run.id, flow: run.flow, leaseUntil: run.leaseExpiresAt! });
      }
    }
    return {
      id: row.id,
      startedAt: row.startedAt,
      heartbeatAt: row.heartbeatAt,
      leaseExpiresAt: row.leaseExpiresAt,
      env: row.env,
      ...(row.pid !== undefined ? { pid: row.pid } : {}),
      clock,
      journal,
    };
  });

  return { kind: "fleet", now, alive: instances.length, instances };
}

/** Options for {@link createInstanceRuntime}. */
export interface CreateInstanceRuntimeOptions {
  readonly instanceId: string;
  readonly store: InstanceStore;
  readonly env: ConfigEnv;
  readonly now?: () => number;
  readonly heartbeatMs?: number;
  readonly leaseMs?: number;
  readonly pid?: number;
}

/** Process-local heartbeat driver over an {@link InstanceStore}. */
export interface InstanceRuntime {
  readonly instanceId: string;
  readonly store: InstanceStore;
  readonly env: ConfigEnv;
  readonly heartbeatMs: number;
  readonly leaseMs: number;
  /**
   * Write a heartbeat when the 5s interval has elapsed (or never written).
   *
   * @param at - Optional epoch-ms
   */
  maybeHeartbeat(at?: number): Promise<void>;
  /**
   * Force a heartbeat write.
   *
   * @param at - Optional epoch-ms
   */
  heartbeat(at?: number): Promise<void>;
  /** Delete this process's row (graceful stop). */
  release(): Promise<void>;
  /** Close the backing store. */
  close(): Promise<void>;
}

/**
 * Create a heartbeat runtime for one process.
 *
 * @param options - Identity, store, env
 */
export function createInstanceRuntime(options: CreateInstanceRuntimeOptions): InstanceRuntime {
  const now = options.now ?? (() => Date.now());
  const heartbeatMs = options.heartbeatMs ?? INSTANCE_HEARTBEAT_MS;
  const leaseMs = options.leaseMs ?? INSTANCE_LEASE_MS;
  const pid = options.pid ?? process.pid;
  const startedAt = now();
  let lastHeartbeatAt = 0;

  const runtime: InstanceRuntime = {
    instanceId: options.instanceId,
    store: options.store,
    env: options.env,
    heartbeatMs,
    leaseMs,
    async maybeHeartbeat(at) {
      const t = at ?? now();
      if (lastHeartbeatAt > 0 && t - lastHeartbeatAt < heartbeatMs) return;
      await runtime.heartbeat(t);
    },
    async heartbeat(at) {
      const t = at ?? now();
      await options.store.upsert({
        id: options.instanceId,
        startedAt,
        heartbeatAt: t,
        leaseExpiresAt: t + leaseMs,
        env: options.env,
        pid,
      });
      lastHeartbeatAt = t;
    },
    async release() {
      await options.store.remove(options.instanceId);
    },
    async close() {
      await options.store.close?.();
    },
  };
  return runtime;
}

function cloneRow(row: InstanceRow): InstanceRow {
  return { ...row };
}

/**
 * In-memory instance store (tests / single process).
 *
 * @param seed - Optional rows
 */
export function createMemoryInstanceStore(seed?: readonly InstanceRow[]): InstanceStore {
  const rows = new Map<string, InstanceRow>();
  for (const row of seed ?? []) {
    rows.set(row.id, cloneRow(row));
  }
  return {
    kind: "memory",
    async upsert(row) {
      const existing = rows.get(row.id);
      rows.set(row.id, cloneRow(existing ? { ...row, startedAt: existing.startedAt } : row));
    },
    async get(id) {
      const row = rows.get(id);
      return row ? cloneRow(row) : undefined;
    },
    async list() {
      return [...rows.values()].map(cloneRow);
    },
    async listAlive(now) {
      return [...rows.values()].filter((r) => r.leaseExpiresAt > now).map(cloneRow);
    },
    async remove(id) {
      rows.delete(id);
    },
  };
}

/** File snapshot shape. */
interface FileInstanceSnapshot {
  readonly rows: InstanceRow[];
}

/**
 * File-backed instance store — multi-process chaos on one host.
 *
 * Every mutation runs under an exclusive lock directory (same as the file
 * CronStore). Does not cache rows across calls.
 *
 * @param path - JSON snapshot path
 */
export function createFileInstanceStore(path: string): InstanceStore {
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
          throw new Error(`createFileInstanceStore: lock timeout on ${lockDir}`);
        }
      }
    }
    try {
      return await fn();
    } finally {
      await rm(lockDir, { recursive: true, force: true });
    }
  }

  async function loadUnlocked(): Promise<Map<string, InstanceRow>> {
    const map = new Map<string, InstanceRow>();
    const file = Bun.file(path);
    if (!(await file.exists())) return map;
    const text = await file.text();
    if (!text.trim()) return map;
    const snap = JSON.parse(text) as FileInstanceSnapshot;
    for (const row of snap.rows ?? []) {
      map.set(row.id, cloneRow(row));
    }
    return map;
  }

  async function flushUnlocked(map: Map<string, InstanceRow>): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const tmp = join(dirname(path), `.${Bun.hash(path).toString(16)}.tmp`);
    const body = JSON.stringify(
      { rows: [...map.values()] } satisfies FileInstanceSnapshot,
      null,
      2,
    );
    await writeFile(tmp, body, "utf8");
    await rename(tmp, path);
  }

  return {
    kind: "file",
    async upsert(row) {
      await withFileLock(async () => {
        const map = await loadUnlocked();
        const existing = map.get(row.id);
        map.set(row.id, cloneRow(existing ? { ...row, startedAt: existing.startedAt } : row));
        await flushUnlocked(map);
      });
    },
    async get(id) {
      return withFileLock(async () => {
        const map = await loadUnlocked();
        const row = map.get(id);
        return row ? cloneRow(row) : undefined;
      });
    },
    async list() {
      return withFileLock(async () => {
        const map = await loadUnlocked();
        return [...map.values()].map(cloneRow);
      });
    },
    async listAlive(now) {
      return withFileLock(async () => {
        const map = await loadUnlocked();
        return [...map.values()].filter((r) => r.leaseExpiresAt > now).map(cloneRow);
      });
    },
    async remove(id) {
      await withFileLock(async () => {
        const map = await loadUnlocked();
        map.delete(id);
        await flushUnlocked(map);
      });
    },
  };
}
