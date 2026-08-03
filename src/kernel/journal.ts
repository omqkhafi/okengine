/**
 * Durable-execution journal.
 *
 * When a flow has `durable: true`, every `fx` call is recorded. On replay,
 * {@link fx.step} never re-runs and {@link fx.clock.sleep} resumes from the
 * recorded wake time — workflows are ordinary flows with one option
 * (four-applications · Provisions).
 */

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { JournalSuspend } from "./journal-suspend.ts";

export { JournalSuspend, isJournalSuspend } from "./journal-suspend.ts";

/** Status of a durable run. */
export type JournalRunStatus = "running" | "sleeping" | "completed" | "failed";

/** A completed named step. */
export interface JournalStepEntry {
  readonly kind: "step";
  readonly name: string;
  readonly value: unknown;
  readonly at: number;
}

/** A durable sleep that survives restart / deploy. */
export interface JournalSleepEntry {
  readonly kind: "sleep";
  readonly label: string;
  readonly duration: string;
  readonly wakeAt: number;
  readonly at: number;
}

/** Any other journaled `fx` call (emit, vault, send, ask, call, …). */
export interface JournalEffectEntry {
  readonly kind: "effect";
  readonly effectKind: string;
  readonly resource: string;
  readonly value: unknown;
  readonly at: number;
}

/** One journaled event in call order. */
export type JournalEntry = JournalStepEntry | JournalSleepEntry | JournalEffectEntry;

/** Persisted durable run. */
export interface JournalRun {
  readonly id: string;
  readonly flow: string;
  readonly input: unknown;
  status: JournalRunStatus;
  readonly entries: JournalEntry[];
  /** Absolute wake epoch-ms when {@link status} is `sleeping`. */
  wakeAt?: number;
  error?: string;
  output?: unknown;
  /** Lease holder instance id (run-level coordination — Signal/Clock physics). */
  lockedBy?: string;
  /** Lease expiry epoch-ms; a crashed holder's run is reclaimable after this. */
  leaseExpiresAt?: number;
  readonly createdAt: number;
  updatedAt: number;
}

/**
 * Run-level lease coordination — same SKIP LOCKED + lazy-reclaim physics as
 * Signal's message claims and Clock's tick claims. No sweeper, no fencing
 * token: at-least-once after lease expiry, journal replay keeps completed
 * steps from re-running.
 */
export interface JournalLeaseStore {
  /**
   * Acquire / renew / reclaim a run lease. Claimable when unlocked, held by
   * the same instance, or expired.
   *
   * @param runId - Run id
   * @param instanceId - Claimant instance
   * @param now - Epoch-ms
   * @param leaseMs - Lease duration
   */
  acquireLease(runId: string, instanceId: string, now: number, leaseMs: number): Promise<boolean>;
  /**
   * Release a lease held by `instanceId` (no-op for other holders).
   *
   * @param runId - Run id
   * @param instanceId - Holder instance
   */
  releaseLease(runId: string, instanceId: string): Promise<void>;
  /**
   * Atomically claim the next due sleep (`status=sleeping`, `wakeAt<=now`, no
   * live lease) and return it — `undefined` when none is claimable.
   *
   * @param instanceId - Claimant instance
   * @param now - Epoch-ms
   * @param leaseMs - Lease duration
   */
  claimDueSleep(instanceId: string, now: number, leaseMs: number): Promise<JournalRun | undefined>;
  /**
   * Boot-time orphan discovery: `running` / `sleeping` runs with no live lease
   * (crashed holder or never claimed). Rows are never deleted.
   *
   * @param now - Epoch-ms
   */
  listOrphans(now: number): Promise<readonly JournalRun[]>;
}

/** Persistence backend for journal runs. */
export interface JournalStore extends Partial<JournalLeaseStore> {
  /**
   * Load a run by id.
   *
   * @param runId - Run id
   */
  get(runId: string): Promise<JournalRun | undefined>;
  /**
   * Persist a run (create or replace).
   *
   * @param run - Run snapshot
   */
  put(run: JournalRun): Promise<void>;
  /** List all runs (test / console helper). */
  list(): Promise<readonly JournalRun[]>;
}

/** Default run lease — matches Signal's claim lease. */
export const JOURNAL_DEFAULT_LEASE_MS = 30_000;

/**
 * Narrow a store to its lease-coordination surface (present on the built-in
 * memory / file / postgres stores; absent on custom minimal stores).
 *
 * @param store - Journal store
 */
export function hasJournalLease(store: JournalStore): store is JournalStore & JournalLeaseStore {
  return (
    typeof store.acquireLease === "function" &&
    typeof store.releaseLease === "function" &&
    typeof store.claimDueSleep === "function" &&
    typeof store.listOrphans === "function"
  );
}

/** Thrown when a run resume loses the lease race to another live instance. */
export class JournalLeaseBusy extends Error {
  readonly runId: string;
  constructor(runId: string) {
    super(`journal: run "${runId}" is leased by another instance`);
    this.name = "JournalLeaseBusy";
    this.runId = runId;
  }
}

/** Type guard for {@link JournalLeaseBusy}. */
export function isJournalLeaseBusy(err: unknown): err is JournalLeaseBusy {
  return err instanceof JournalLeaseBusy;
}

/** Live lease = a holder with an unexpired expiry. */
function hasLiveLease(run: JournalRun, now: number): boolean {
  return run.lockedBy !== undefined && run.leaseExpiresAt !== undefined && run.leaseExpiresAt > now;
}

/** Claimable when unlocked, same-holder, or without a live lease. */
function claimable(run: JournalRun, instanceId: string, now: number): boolean {
  if (run.lockedBy === undefined) return true;
  if (run.lockedBy === instanceId) return true;
  return !hasLiveLease(run, now);
}

/** Lease methods shared by the memory + file stores (single-writer maps). */
function leaseMethods(
  load: () => Promise<Map<string, JournalRun>>,
  flush?: (map: Map<string, JournalRun>) => Promise<void>,
): JournalLeaseStore {
  return {
    async acquireLease(runId, instanceId, now, leaseMs) {
      const map = await load();
      const run = map.get(runId);
      if (!run || !claimable(run, instanceId, now)) return false;
      run.lockedBy = instanceId;
      run.leaseExpiresAt = now + leaseMs;
      await flush?.(map);
      return true;
    },
    async releaseLease(runId, instanceId) {
      const map = await load();
      const run = map.get(runId);
      if (!run || run.lockedBy !== instanceId) return;
      delete run.lockedBy;
      delete run.leaseExpiresAt;
      await flush?.(map);
    },
    async claimDueSleep(instanceId, now, leaseMs) {
      const map = await load();
      const due = [...map.values()]
        .filter(
          (r) =>
            r.status === "sleeping" &&
            r.wakeAt !== undefined &&
            r.wakeAt <= now &&
            claimable(r, instanceId, now),
        )
        .sort((a, b) => (a.wakeAt ?? 0) - (b.wakeAt ?? 0))[0];
      if (!due) return undefined;
      due.lockedBy = instanceId;
      due.leaseExpiresAt = now + leaseMs;
      await flush?.(map);
      return cloneRun(due);
    },
    async listOrphans(now) {
      const map = await load();
      return [...map.values()]
        .filter((r) => (r.status === "running" || r.status === "sleeping") && !hasLiveLease(r, now))
        .map(cloneRun);
    },
  };
}

/** In-memory journal store. */
export function createMemoryJournalStore(seed?: readonly JournalRun[]): JournalStore {
  const runs = new Map<string, JournalRun>();
  for (const r of seed ?? []) {
    runs.set(r.id, cloneRun(r));
  }
  const load = async (): Promise<Map<string, JournalRun>> => runs;
  return {
    async get(runId) {
      const r = runs.get(runId);
      return r ? cloneRun(r) : undefined;
    },
    async put(run) {
      runs.set(run.id, cloneRun(run));
    },
    async list() {
      return [...runs.values()].map(cloneRun);
    },
    ...leaseMethods(load),
  };
}

/**
 * File-backed journal store — survives process restart (chaos / deploy tests).
 *
 * @param path - JSON file path
 */
export function createFileJournalStore(path: string): JournalStore {
  let cache: Map<string, JournalRun> | null = null;

  async function load(): Promise<Map<string, JournalRun>> {
    if (cache) return cache;
    cache = new Map();
    const file = Bun.file(path);
    if (await file.exists()) {
      const raw = (await file.json()) as { runs?: JournalRun[] };
      for (const r of raw.runs ?? []) {
        cache.set(r.id, cloneRun(r));
      }
    }
    return cache;
  }

  async function flush(map: Map<string, JournalRun>): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, JSON.stringify({ runs: [...map.values()] }, null, 2));
  }

  return {
    async get(runId) {
      const map = await load();
      const r = map.get(runId);
      return r ? cloneRun(r) : undefined;
    },
    async put(run) {
      const map = await load();
      map.set(run.id, cloneRun(run));
      await flush(map);
    },
    async list() {
      const map = await load();
      return [...map.values()].map(cloneRun);
    },
    // Single-host file: leases coordinate same-machine processes only.
    ...leaseMethods(load, flush),
  };
}

/** Run-level lease holder for {@link CreateJournalOptions.lease}. */
export interface JournalLeaseOptions {
  /** This instance's id (lease holder). */
  readonly instanceId: string;
  /** Lease duration ms (default {@link JOURNAL_DEFAULT_LEASE_MS}). */
  readonly leaseMs?: number;
}

/** Options for {@link createJournal}. */
export interface CreateJournalOptions {
  /** Persistence backend. */
  readonly store: JournalStore;
  /** Clock for timestamps. */
  readonly now?: () => number;
  /** Id factory (defaults to UUID). */
  readonly id?: () => string;
  /**
   * Run-level lease (when the store supports it). `start` inserts with the
   * lease held; `resume` claims the run or throws {@link JournalLeaseBusy};
   * every persist renews; parking a sleep and terminal commits release so a
   * sleeping/finished run never holds a 30s lock.
   */
  readonly lease?: JournalLeaseOptions;
}

/**
 * Session bound to one attempt of a durable run — records and replays
 * journal entries in call order.
 */
export interface JournalSession {
  /** Run id. */
  readonly runId: string;
  /** Underlying run snapshot (mutated as entries append). */
  readonly run: JournalRun;
  /**
   * Replay or execute a named step. Never re-runs `fn` when already journaled.
   *
   * @param name - Step name
   * @param fn - Step body
   */
  step<T>(name: string, fn: () => T | Promise<T>): Promise<T>;
  /**
   * Durable sleep — journals wake time; suspends until elapsed.
   *
   * @param label - Sleep label
   * @param duration - Duration string (`7d`, `2m`, …)
   * @param parseMs - Duration → milliseconds
   */
  sleep(label: string, duration: string, parseMs: (duration: string) => number): Promise<void>;
  /**
   * Journal an arbitrary fx effect (replay returns recorded value).
   *
   * @param effectKind - Effect kind key
   * @param resource - Resource ref
   * @param execute - Side-effecting body
   */
  effect<T>(effectKind: string, resource: string, execute: () => T | Promise<T>): Promise<T>;
  /**
   * Rewind the replay cursor to the start of the entry list.
   * Used by flow-level retry so a re-entered `do` replays completed steps
   * instead of treating the cursor as past them.
   */
  rewind(): void;
  /** Persist current run status / output. */
  commit(
    status: JournalRunStatus,
    patch?: { readonly wakeAt?: number; readonly output?: unknown; readonly error?: string },
  ): Promise<void>;
}

/** Journal facade. */
export interface Journal {
  readonly store: JournalStore;
  /**
   * Start a new durable run.
   *
   * @param flow - Flow name
   * @param input - Input payload
   */
  start(flow: string, input?: unknown): Promise<JournalSession>;
  /**
   * Open an existing run for resume / replay.
   *
   * @param runId - Run id
   */
  resume(runId: string): Promise<JournalSession>;
}

/**
 * Create a journal bound to a store.
 *
 * @param options - Store and clock
 */
export function createJournal(options: CreateJournalOptions): Journal {
  const now = options.now ?? (() => Date.now());
  const newId = options.id ?? (() => crypto.randomUUID());
  const lease = options.lease;
  const coordinated = lease !== undefined && hasJournalLease(options.store);

  function openSession(run: JournalRun, leased: boolean): JournalSession {
    /** Next entry index to consume on replay. */
    let cursor = 0;
    let leaseHeld = leased;

    async function persist(): Promise<void> {
      run.updatedAt = now();
      // Natural heartbeat — a live holder renews on every journal write.
      if (leaseHeld && lease) {
        run.lockedBy = lease.instanceId;
        run.leaseExpiresAt = now() + (lease.leaseMs ?? JOURNAL_DEFAULT_LEASE_MS);
      }
      await options.store.put(cloneRun(run));
    }

    /** Parking / terminal states must not hold a short lease across days. */
    function releaseLeaseLocally(): void {
      leaseHeld = false;
      delete run.lockedBy;
      delete run.leaseExpiresAt;
    }

    return {
      runId: run.id,
      run,
      async step<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
        // Prefer name match among remaining entries (resume after crash).
        for (let i = cursor; i < run.entries.length; i++) {
          const e = run.entries[i]!;
          if (e.kind === "step" && e.name === name) {
            cursor = i + 1;
            return e.value as T;
          }
        }
        const value = await fn();
        const entry: JournalStepEntry = {
          kind: "step",
          name,
          value,
          at: now(),
        };
        run.entries.push(entry);
        cursor = run.entries.length;
        await persist();
        return value;
      },
      async sleep(label, duration, parseMs) {
        for (let i = cursor; i < run.entries.length; i++) {
          const e = run.entries[i]!;
          if (e.kind === "sleep" && e.label === label) {
            cursor = i + 1;
            if (now() < e.wakeAt) {
              run.status = "sleeping";
              run.wakeAt = e.wakeAt;
              releaseLeaseLocally();
              await persist();
              throw new JournalSuspend(label, e.wakeAt);
            }
            return;
          }
        }
        const wakeAt = now() + parseMs(duration);
        const entry: JournalSleepEntry = {
          kind: "sleep",
          label,
          duration,
          wakeAt,
          at: now(),
        };
        run.entries.push(entry);
        cursor = run.entries.length;
        if (now() < wakeAt) {
          run.status = "sleeping";
          run.wakeAt = wakeAt;
          releaseLeaseLocally();
          await persist();
          throw new JournalSuspend(label, wakeAt);
        }
        await persist();
      },
      async effect<T>(
        effectKind: string,
        resource: string,
        execute: () => T | Promise<T>,
      ): Promise<T> {
        for (let i = cursor; i < run.entries.length; i++) {
          const e = run.entries[i]!;
          if (e.kind === "effect" && e.effectKind === effectKind && e.resource === resource) {
            cursor = i + 1;
            return e.value as T;
          }
        }
        const value = await execute();
        const entry: JournalEffectEntry = {
          kind: "effect",
          effectKind,
          resource,
          value,
          at: now(),
        };
        run.entries.push(entry);
        cursor = run.entries.length;
        await persist();
        return value;
      },
      rewind() {
        cursor = 0;
      },
      async commit(status, patch) {
        run.status = status;
        if (patch?.wakeAt !== undefined) run.wakeAt = patch.wakeAt;
        if (patch?.output !== undefined) run.output = patch.output;
        if (patch?.error !== undefined) run.error = patch.error;
        if (status === "completed" || status === "failed") {
          delete run.wakeAt;
          releaseLeaseLocally();
        }
        await persist();
      },
    };
  }

  return {
    store: options.store,
    async start(flow, input) {
      const t = now();
      const run: JournalRun = {
        id: newId(),
        flow,
        input,
        status: "running",
        entries: [],
        createdAt: t,
        updatedAt: t,
      };
      if (coordinated && lease) {
        // Fresh id — insert already holding the lease (no claim race).
        run.lockedBy = lease.instanceId;
        run.leaseExpiresAt = t + (lease.leaseMs ?? JOURNAL_DEFAULT_LEASE_MS);
      }
      await options.store.put(cloneRun(run));
      return openSession(run, coordinated);
    },
    async resume(runId) {
      if (coordinated && lease) {
        const t = now();
        const claimed = await options.store.acquireLease!(
          runId,
          lease.instanceId,
          t,
          lease.leaseMs ?? JOURNAL_DEFAULT_LEASE_MS,
        );
        if (!claimed) {
          throw new JournalLeaseBusy(runId);
        }
      }
      const run = await options.store.get(runId);
      if (!run) {
        if (coordinated && lease) {
          await options.store.releaseLease!(runId, lease.instanceId);
        }
        throw new Error(`journal: run "${runId}" not found`);
      }
      // Leave status intact — the durable runner parks or continues.
      run.updatedAt = now();
      if (coordinated && lease) {
        run.lockedBy = lease.instanceId;
        run.leaseExpiresAt = now() + (lease.leaseMs ?? JOURNAL_DEFAULT_LEASE_MS);
      }
      await options.store.put(cloneRun(run));
      return openSession(run, coordinated);
    },
  };
}

function cloneRun(run: JournalRun): JournalRun {
  return structuredClone(run);
}
