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
import { okid } from "../okid.ts";
import { OkeError, throwOke } from "./errors.ts";
import type { DecisionLabelStore } from "./decision-label-store.ts";
import type { IdempotencyStore } from "./idempotency-store.ts";
import { JournalSuspend } from "./journal-suspend.ts";
import { lazyRequire } from "./lazy-require.ts";

export { JournalSuspend, isJournalSuspend } from "./journal-suspend.ts";

/** Status of a durable run. */
export type JournalRunStatus = "running" | "sleeping" | "compensating" | "completed" | "failed";

/** Reserved prefix for compensation undo steps — never use for forward work. */
export const JOURNAL_UNDO_PREFIX = "undo:";

/**
 * Options for {@link JournalSession.step}.
 *
 * @typeParam T - Step result type
 */
export interface JournalStepOptions<T> {
  /**
   * Durable undo for this step — registered on persist and replay.
   * Invoked with the journaled value on terminal failure (LIFO).
   */
  readonly undo?: (value: T) => unknown | Promise<unknown>;
}

/** One registered per-step undo frame (in-memory; closures re-bound on resume). */
export interface JournalUndoFrame {
  /** Forward step name (without {@link JOURNAL_UNDO_PREFIX}). */
  readonly name: string;
  /** Journaled step value passed to {@link undo}. */
  readonly value: unknown;
  /** Undo body. */
  readonly undo: (value: unknown) => unknown | Promise<unknown>;
}

/**
 * Thrown during a compensating registration pass when `do` would execute
 * new forward work — stops re-entry without continuing the happy path.
 */
export class JournalRegistrationComplete extends Error {
  constructor() {
    super("journal: registration pass complete");
    this.name = "JournalRegistrationComplete";
  }
}

/** Type guard for {@link JournalRegistrationComplete}. */
export function isJournalRegistrationComplete(err: unknown): err is JournalRegistrationComplete {
  return err instanceof JournalRegistrationComplete;
}

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
  /**
   * Fencing token. Bumped on each acquire that is not a live same-holder renew.
   * Writes from a previous holder are rejected.
   */
  leaseToken?: number;
  /** Code version stamped at start. Resume fails when the process version differs. */
  codeVersion?: string;
  readonly createdAt: number;
  updatedAt: number;
  /** Isolation context for resume (`fx.tenant`). */
  tenant?: string | null;
}

/** Fence presented with every leased journal write. */
export interface JournalWriteFence {
  readonly lockedBy: string;
  readonly leaseToken: number;
  /** Epoch-ms used to reject an expired holder. */
  readonly now: number;
}

/**
 * Run-level lease coordination — same SKIP LOCKED + lazy-reclaim physics as
 * Signal's message claims and Clock's tick claims. No sweeper. A fencing
 * token rejects writes from a holder whose lease was reclaimed.
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
   * Extend `lease_expires_at` without changing the fencing token.
   * Returns false when this holder no longer owns the run.
   *
   * @param runId - Run id
   * @param expiresAt - New expiry, epoch-ms
   * @param fence - Caller's lease fence
   */
  renewLeaseExpiry?(runId: string, expiresAt: number, fence: JournalWriteFence): Promise<boolean>;
  /**
   * Take the lease and write `update(run)` in that same hold.
   * `undefined` from `update` keeps the previous entries and still holds the lease.
   * `"lease"` means another holder won. `"missing"` means no run.
   *
   * @param runId - Run id
   * @param instanceId - Claimant instance
   * @param now - Epoch-ms
   * @param leaseMs - Lease duration
   * @param update - Next snapshot, or undefined to leave entries
   */
  cas(
    runId: string,
    instanceId: string,
    now: number,
    leaseMs: number,
    update: (run: JournalRun) => JournalRun | undefined,
  ): Promise<"ok" | "missing" | { readonly lease: true; readonly leaseExpiresAt?: number }>;
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
   * Boot-time orphan discovery: `running` / `sleeping` / `compensating` runs
   * with no live lease (crashed holder or never claimed). Rows are never deleted.
   *
   * @param now - Epoch-ms
   */
  listOrphans(now: number): Promise<readonly JournalRun[]>;
}

/**
 * Load the idempotency table implementation without a static import.
 * Computed stem so the edge profile does not inline it.
 */
function loadIdempotencyStore(): typeof import("./idempotency-store.ts") {
  return lazyRequire(import.meta.dir, ["idempotency", "store"].join("-"));
}

/**
 * Load the decision-label table without a static import.
 */
function loadDecisionLabelStore(): typeof import("./decision-label-store.ts") {
  return lazyRequire(import.meta.dir, ["decision", "label", "store"].join("-"));
}

/**
 * Load the agent-event table without a static import.
 */
function loadAgentEventStore(): typeof import("./agent-event-store.ts") {
  return lazyRequire(import.meta.dir, ["agent", "event", "store"].join("-"));
}

/** Persistence backend for journal runs. */
export interface JournalStore extends Partial<JournalLeaseStore> {
  /**
   * Idempotency records on this same driver. Absent on a custom store that
   * only implements run `get` / `put`.
   */
  readonly idempotency?: IdempotencyStore;
  /**
   * Decision labels and the drift flag on this same driver. Opened only when
   * the app declares decisions.
   */
  readonly decisions?: DecisionLabelStore;
  /**
   * Agent-run event log on this same driver. Followers resume from these rows
   * after a restart and from another instance.
   */
  readonly agentEvents?: import("./agent-event-store.ts").AgentEventStore;
  /**
   * Load a run by id.
   *
   * @param runId - Run id
   */
  get(runId: string): Promise<JournalRun | undefined>;
  /**
   * Persist a run header (create or replace).
   *
   * When {@link JournalStore.appendEntry} is present, `entries` on this
   * snapshot may be empty — the store keeps previously appended rows.
   *
   * @param run - Run snapshot
   * @param fence - Required for a leased update. Omitted on the first insert
   *   and on uncoordinated stores.
   */
  put(run: JournalRun, fence?: JournalWriteFence): Promise<void>;
  /**
   * Append one journal entry. Built-in stores implement this so a step does
   * not rewrite earlier entries.
   *
   * @param runId - Run id
   * @param seq - Zero-based position
   * @param entry - JSON-safe entry
   * @param fence - Lease fence when the run is coordinated
   */
  appendEntry?(
    runId: string,
    seq: number,
    entry: JournalEntry,
    fence?: JournalWriteFence,
  ): Promise<void>;
  /**
   * Replace one existing entry under the caller's fence. Built-in stores
   * implement this so approval and decide can correct a step without
   * rewriting the run. Absent on a custom store — callers keep `put`.
   *
   * @param runId - Run id
   * @param seq - Zero-based position
   * @param entry - Replacement entry
   * @param fence - Lease fence
   */
  updateEntry?(
    runId: string,
    seq: number,
    entry: JournalEntry,
    fence: JournalWriteFence,
  ): Promise<void>;
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

/**
 * A fenced write lost the lease (OKE1074). The holder must not compensate
 * or record the step — another instance may already own the run.
 *
 * @param err - Caught error
 */
export function isLostJournalLease(err: unknown): boolean {
  return err instanceof OkeError && err.code === 1074;
}

const heartbeatTimers = new Set<ReturnType<typeof setInterval>>();

/**
 * Stop every session heartbeat. `stop` and `close` call this so a shut
 * down process does not keep renewing leases it no longer owns.
 */
export function clearJournalHeartbeats(): void {
  for (const timer of heartbeatTimers) clearInterval(timer);
  heartbeatTimers.clear();
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
  let gate: Promise<void> = Promise.resolve();
  return {
    async acquireLease(runId, instanceId, now, leaseMs) {
      const map = await load();
      const run = map.get(runId);
      if (!run || !claimable(run, instanceId, now)) return false;
      holdLease(run, instanceId, now, leaseMs);
      await flush?.(map);
      return true;
    },
    async cas(runId, instanceId, now, leaseMs, update) {
      let release!: () => void;
      const slot = new Promise<void>((resolve) => {
        release = resolve;
      });
      const prev = gate;
      gate = slot;
      await prev;
      try {
        const map = await load();
        const run = map.get(runId);
        if (!run) return "missing";
        if (!claimable(run, instanceId, now)) {
          return { lease: true, leaseExpiresAt: run.leaseExpiresAt };
        }
        const next = update(cloneRun(run)) ?? run;
        holdLease(next, instanceId, now, leaseMs);
        if (run.entries.length > 0 && next.entries.length === 0) {
          (next as { entries: JournalEntry[] }).entries = run.entries;
        }
        map.set(runId, next);
        await flush?.(map);
        return "ok";
      } finally {
        release();
      }
    },
    async renewLeaseExpiry(runId, expiresAt, fence) {
      const map = await load();
      const run = map.get(runId);
      if (!run) return false;
      const expired = run.leaseExpiresAt !== undefined && run.leaseExpiresAt <= fence.now;
      if (run.lockedBy !== fence.lockedBy || run.leaseToken !== fence.leaseToken || expired) {
        return false;
      }
      if (run.leaseExpiresAt === undefined || run.leaseExpiresAt < expiresAt) {
        run.leaseExpiresAt = expiresAt;
      }
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
      holdLease(due, instanceId, now, leaseMs);
      await flush?.(map);
      return cloneRun(due);
    },
    async listOrphans(now) {
      const map = await load();
      return [...map.values()]
        .filter(
          (r) =>
            (r.status === "running" || r.status === "sleeping" || r.status === "compensating") &&
            !hasLiveLease(r, now),
        )
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
    async put(run, fence) {
      const existing = runs.get(run.id);
      assertJournalFence(existing, fence);
      runs.set(run.id, mergeJournalPut(existing, run));
    },
    async appendEntry(runId, seq, entry, fence) {
      const existing = runs.get(runId);
      if (!existing) throw new Error(`journal: run "${runId}" not found`);
      assertJournalFence(existing, fence);
      appendStoredEntry(existing, seq, entry);
    },
    async updateEntry(runId, seq, entry, fence) {
      const existing = runs.get(runId);
      if (!existing) throwOke("JOURNAL_STALE_LEASE", { runId });
      assertJournalFence(existing, fence);
      const entries = existing.entries as JournalEntry[];
      if (!entries[seq]) throwOke("JOURNAL_STALE_LEASE", { runId });
      entries[seq] = structuredClone(entry);
    },
    async list() {
      return [...runs.values()].map(cloneRun);
    },
    ...leaseMethods(load),
    get idempotency(): IdempotencyStore {
      const created = loadIdempotencyStore().createMemoryIdempotencyStore();
      Object.defineProperty(this, "idempotency", { value: created });
      return created;
    },
    get decisions(): DecisionLabelStore {
      const created = loadDecisionLabelStore().createMemoryDecisionLabelStore();
      Object.defineProperty(this, "decisions", { value: created });
      return created;
    },
    get agentEvents(): import("./agent-event-store.ts").AgentEventStore {
      const created = loadAgentEventStore().createMemoryAgentEventStore();
      Object.defineProperty(this, "agentEvents", { value: created });
      return created;
    },
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
    async put(run, fence) {
      const map = await load();
      const existing = map.get(run.id);
      assertJournalFence(existing, fence);
      map.set(run.id, mergeJournalPut(existing, run));
      await flush(map);
    },
    async appendEntry(runId, seq, entry, fence) {
      const map = await load();
      const existing = map.get(runId);
      if (!existing) throw new Error(`journal: run "${runId}" not found`);
      assertJournalFence(existing, fence);
      appendStoredEntry(existing, seq, entry);
      await flush(map);
    },
    async updateEntry(runId, seq, entry, fence) {
      const map = await load();
      const existing = map.get(runId);
      if (!existing) throwOke("JOURNAL_STALE_LEASE", { runId });
      assertJournalFence(existing, fence);
      const entries = existing.entries as JournalEntry[];
      if (!entries[seq]) throwOke("JOURNAL_STALE_LEASE", { runId });
      entries[seq] = structuredClone(entry);
      await flush(map);
    },
    async list() {
      const map = await load();
      return [...map.values()].map(cloneRun);
    },
    // Single-host file: leases coordinate same-machine processes only.
    ...leaseMethods(load, flush),
    get idempotency(): IdempotencyStore {
      const created = loadIdempotencyStore().createFileIdempotencyStore(
        `${dirname(path)}/idempotency.json`,
      );
      Object.defineProperty(this, "idempotency", { value: created });
      return created;
    },
    get decisions(): DecisionLabelStore {
      const created = loadDecisionLabelStore().createFileDecisionLabelStore(
        `${dirname(path)}/decision-labels.json`,
      );
      Object.defineProperty(this, "decisions", { value: created });
      return created;
    },
    get agentEvents(): import("./agent-event-store.ts").AgentEventStore {
      const created = loadAgentEventStore().createFileAgentEventStore(
        `${dirname(path)}/agent-events`,
      );
      Object.defineProperty(this, "agentEvents", { value: created });
      return created;
    },
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
  /**
   * Code version stamped on new runs. Resume of a different version fails.
   * Defaults to the package version.
   */
  readonly codeVersion?: string;
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
   * Persist isolation context so resume restamps {@link Fx.tenant}.
   *
   * @param id - Tenant id (null clears)
   */
  stampTenant(id: string | null): Promise<void>;
  /**
   * Replay or execute a named step. Never re-runs `fn` when already journaled.
   *
   * @param name - Step name
   * @param fn - Step body
   * @param opts - Optional per-step undo registration
   */
  step<T>(name: string, fn: () => T | Promise<T>, opts?: JournalStepOptions<T>): Promise<T>;
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
   * instead of treating the cursor as past them. Clears the in-memory undo stack
   * so frames re-bind on the next walk.
   */
  /**
   * Increments on {@link JournalSession.rewind}. Agent run ids key off this
   * so `flow.retry` replays the same id.
   */
  readonly epoch: number;
  rewind(): void;
  /**
   * Entries already replayed or appended. The row under the cursor is excluded
   * so a replayed call does not count itself.
   */
  recordedBeforeCursor(): readonly JournalEntry[];
  /** Registered per-step undos in persist/replay order (LIFO compensate). */
  undoStack(): readonly JournalUndoFrame[];
  /**
   * Enter registration-only mode — replay + re-bind undos; new forward work
   * throws {@link JournalRegistrationComplete}.
   */
  beginRegistrationPass(): void;
  /** Exit registration-only mode. */
  endRegistrationPass(): void;
  /**
   * Allow appending `undo:*` steps (compensation phase only).
   *
   * @param allowed - Whether undo-prefix steps may append
   */
  setUndoExecution(allowed: boolean): void;
  /** Persist current run status / output. */
  commit(
    status: JournalRunStatus,
    patch?: { readonly wakeAt?: number; readonly output?: unknown; readonly error?: string },
  ): Promise<void>;
}

/**
 * A journal session that forwards to a real session once one is assigned.
 *
 * Idempotent durable flows start the journal only after the claim, which is
 * after `fx` has already been created.
 */
export function createJournalSlot(): {
  readonly slot: { session?: JournalSession };
  readonly facade: JournalSession;
} {
  const slot: { session?: JournalSession } = {};
  const facade = new Proxy({} as JournalSession, {
    get(_target, prop, receiver) {
      const session = slot.session;
      if (!session) {
        if (prop === "runId") return "";
        if (prop === "epoch") return 0;
        if (prop === "stampTenant") return async () => undefined;
        if (prop === "rewind") return () => undefined;
        return undefined;
      }
      const value = Reflect.get(session, prop, receiver);
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(session)
        : value;
    },
  });
  return { slot, facade };
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
  const newId = options.id ?? (() => okid());
  const lease = options.lease;
  const codeVersion = stampAppVersion(options.codeVersion);
  const coordinated = lease !== undefined && hasJournalLease(options.store);

  function openSession(run: JournalRun, leased: boolean): JournalSession {
    /** Next entry index to consume on replay. */
    let cursor = 0;
    let epoch = 0;
    let leaseHeld = leased;
    let registrationPass = false;
    let undoExecution = false;
    let stepDepth = 0;
    /** Outer `effect` calls re-enter when the next row was written by a nested call. */
    let effectDepth = 0;
    const undos: JournalUndoFrame[] = [];

    function fence(): JournalWriteFence | undefined {
      if (!leaseHeld || !lease || run.leaseToken === undefined || run.lockedBy === undefined) {
        return undefined;
      }
      return { lockedBy: run.lockedBy, leaseToken: run.leaseToken, now: now() };
    }

    async function persist(entry?: JournalEntry): Promise<void> {
      if (lostLease) throwOke("JOURNAL_STALE_LEASE", { runId: run.id });
      run.updatedAt = now();
      // Natural heartbeat — a live holder renews on every journal write.
      if (leaseHeld && lease) {
        run.lockedBy = lease.instanceId;
        run.leaseExpiresAt = now() + (lease.leaseMs ?? JOURNAL_DEFAULT_LEASE_MS);
      }
      const writeFence = fence();
      if (entry && options.store.appendEntry) {
        try {
          await options.store.appendEntry(run.id, run.entries.length - 1, entry, writeFence);
        } catch (err) {
          // The session list was edited in place (a test drops replayed rows).
          // The stored rows no longer match, so replace them from the session.
          if (!(err instanceof Error) || !err.message.includes("does not append")) throw err;
          await options.store.put(cloneRun(run), writeFence);
          return;
        }
      }
      const header = cloneRun(run);
      if (options.store.appendEntry) (header as { entries: JournalEntry[] }).entries = [];
      await options.store.put(header, writeFence);
    }

    /**
     * The next entry must match this call. Scanning forward would hide a
     * reordered step.
     */
    function takeReplay(
      match: (entry: JournalEntry) => boolean,
      called: string,
    ): JournalEntry | undefined {
      if (cursor >= run.entries.length) return undefined;
      const entry = run.entries[cursor];
      if (entry === undefined || !match(entry)) {
        throwOke("JOURNAL_REPLAY_DIVERGENCE", {
          runId: run.id,
          expected: entry === undefined ? "end" : entryLabel(entry),
          actual: called,
        });
      }
      cursor += 1;
      return entry;
    }

    /** Parking / terminal states must not hold a short lease across days. */
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let lostLease = false;
    let activeStep = "";

    function stopHeartbeat(): void {
      if (!heartbeat) return;
      clearInterval(heartbeat);
      heartbeatTimers.delete(heartbeat);
      heartbeat = undefined;
    }

    function startHeartbeat(): void {
      if (!leased || !lease || heartbeat) return;
      const every = Math.max(1, Math.floor((lease.leaseMs ?? JOURNAL_DEFAULT_LEASE_MS) / 3));
      heartbeat = setInterval(() => {
        void (async () => {
          if (!leaseHeld || lostLease || !options.store.renewLeaseExpiry) return;
          const writeFence = fence();
          if (!writeFence) return;
          const expiresAt = now() + (lease.leaseMs ?? JOURNAL_DEFAULT_LEASE_MS);
          const ok = await options.store.renewLeaseExpiry(run.id, expiresAt, writeFence);
          if (!ok) {
            lostLease = true;
            console.warn(
              JSON.stringify({
                event: "journal.lease.lost",
                runId: run.id,
                step: activeStep,
                instanceId: lease.instanceId,
              }),
            );
            return;
          }
          if (run.leaseExpiresAt === undefined || run.leaseExpiresAt < expiresAt) {
            run.leaseExpiresAt = expiresAt;
          }
        })();
      }, every);
      heartbeat.unref?.();
      heartbeatTimers.add(heartbeat);
    }

    function releaseLeaseLocally(): void {
      leaseHeld = false;
      lostLease = false;
      stopHeartbeat();
      delete run.lockedBy;
      delete run.leaseExpiresAt;
    }

    function registerUndo<T>(name: string, value: T, opts?: JournalStepOptions<T>): void {
      if (!opts?.undo) return;
      const undo = opts.undo as (value: unknown) => unknown | Promise<unknown>;
      const idx = undos.findIndex((f) => f.name === name);
      const frame: JournalUndoFrame = { name, value, undo };
      if (idx >= 0) undos[idx] = frame;
      else undos.push(frame);
    }

    function assertCanAppendStep(name: string): void {
      if (registrationPass) {
        throw new JournalRegistrationComplete();
      }
      const isUndoStep = name.startsWith(JOURNAL_UNDO_PREFIX);
      if (isUndoStep && !undoExecution) {
        throw new Error(
          `journal: step name "${name}" uses reserved prefix "${JOURNAL_UNDO_PREFIX}"`,
        );
      }
      if (!isUndoStep && run.entries.some((e) => e.kind === "step" && e.name === name)) {
        throw new Error(`journal: duplicate step name "${name}"`);
      }
    }

    if (leased) startHeartbeat();

    return {
      runId: run.id,
      run,
      async step<T>(
        name: string,
        fn: () => T | Promise<T>,
        opts?: JournalStepOptions<T>,
      ): Promise<T> {
        if (name.startsWith(JOURNAL_UNDO_PREFIX) && opts?.undo) {
          throw new Error("journal: undo steps cannot register nested undo");
        }
        const replayed = takeReplay((e) => e.kind === "step" && e.name === name, `step ${name}`);
        if (replayed && replayed.kind === "step") {
          const value = reviveJournalValue(replayed.value) as T;
          if (!name.startsWith(JOURNAL_UNDO_PREFIX)) {
            registerUndo(name, value, opts);
          }
          return value;
        }
        assertCanAppendStep(name);
        activeStep = name;
        stepDepth += 1;
        let stored: unknown;
        try {
          stored = await journalValue(await fn());
        } finally {
          stepDepth -= 1;
        }
        if (lostLease) throwOke("JOURNAL_STALE_LEASE", { runId: run.id });
        const value = reviveJournalValue(stored) as T;
        const entry: JournalStepEntry = {
          kind: "step",
          name,
          value: stored,
          at: now(),
        };
        run.entries.push(entry);
        cursor = run.entries.length;
        try {
          await persist(entry);
        } catch (err) {
          run.entries.pop();
          cursor = run.entries.length;
          throw err;
        }
        if (!name.startsWith(JOURNAL_UNDO_PREFIX)) {
          registerUndo(name, value, opts);
        }
        return value;
      },
      async sleep(label, duration, parseMs) {
        const replayed = takeReplay(
          (e) => e.kind === "sleep" && e.label === label,
          `sleep ${label}`,
        );
        if (replayed && replayed.kind === "sleep") {
          if (now() < replayed.wakeAt) {
            run.status = "sleeping";
            run.wakeAt = replayed.wakeAt;
            releaseLeaseLocally();
            await persist();
            throw new JournalSuspend(label, replayed.wakeAt);
          }
          return;
        }
        if (registrationPass) {
          throw new JournalRegistrationComplete();
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
          await persist(entry);
          throw new JournalSuspend(label, wakeAt);
        }
        await persist(entry);
      },
      async effect<T>(
        effectKind: string,
        resource: string,
        execute: () => T | Promise<T>,
      ): Promise<T> {
        // Inside fx.step the step value is the snapshot. A nested effect must
        // not insert a row ahead of that step, or replay would diverge.
        if (stepDepth > 0) return execute();
        const called = `effect ${effectKind} ${resource}`;
        const next = cursor < run.entries.length ? run.entries[cursor] : undefined;
        const matches =
          next?.kind === "effect" && next.effectKind === effectKind && next.resource === resource;
        if (matches && next.kind === "effect") {
          cursor += 1;
          return reviveJournalValue(next.value) as T;
        }
        // A nested call must hit its own row. An outer call re-enters: its row
        // is appended after the nested rows, so it is not next yet.
        if (next !== undefined && effectDepth > 0) {
          throwOke("JOURNAL_REPLAY_DIVERGENCE", {
            runId: run.id,
            expected: entryLabel(next),
            actual: called,
          });
        }
        if (registrationPass) {
          throw new JournalRegistrationComplete();
        }
        effectDepth += 1;
        let stored: unknown;
        try {
          stored = await journalValue(await execute());
        } finally {
          effectDepth -= 1;
        }
        const after = cursor < run.entries.length ? run.entries[cursor] : undefined;
        if (
          after?.kind === "effect" &&
          after.effectKind === effectKind &&
          after.resource === resource
        ) {
          cursor += 1;
          return reviveJournalValue(after.value) as T;
        }
        if (after !== undefined) {
          throwOke("JOURNAL_REPLAY_DIVERGENCE", {
            runId: run.id,
            expected: entryLabel(after),
            actual: called,
          });
        }
        const entry: JournalEffectEntry = {
          kind: "effect",
          effectKind,
          resource,
          value: stored,
          at: now(),
        };
        run.entries.push(entry);
        cursor = run.entries.length;
        await persist(entry);
        return reviveJournalValue(stored) as T;
      },
      get epoch() {
        return epoch;
      },
      rewind() {
        cursor = 0;
        undos.length = 0;
        epoch += 1;
      },
      recordedBeforeCursor() {
        return run.entries.slice(0, cursor);
      },
      undoStack() {
        return undos;
      },
      async stampTenant(id) {
        run.tenant = id;
        await persist();
      },
      beginRegistrationPass() {
        registrationPass = true;
      },
      endRegistrationPass() {
        registrationPass = false;
      },
      setUndoExecution(allowed) {
        undoExecution = allowed;
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
        codeVersion,
        createdAt: t,
        updatedAt: t,
      };
      if (coordinated && lease) {
        // Fresh id — insert already holding the lease (no claim race).
        run.lockedBy = lease.instanceId;
        run.leaseExpiresAt = t + (lease.leaseMs ?? JOURNAL_DEFAULT_LEASE_MS);
        run.leaseToken = 1;
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
      if (
        codeVersion !== undefined &&
        run.codeVersion !== undefined &&
        run.codeVersion !== codeVersion
      ) {
        if (run.codeVersion.startsWith("app:")) {
          run.status = "failed";
          run.error = "OKE1076";
          run.updatedAt = now();
          const skewFence =
            coordinated && lease && run.leaseToken !== undefined && run.lockedBy !== undefined
              ? { lockedBy: run.lockedBy, leaseToken: run.leaseToken, now: now() }
              : undefined;
          await options.store.put(cloneRun(run), skewFence);
          if (coordinated && lease) {
            await options.store.releaseLease!(runId, lease.instanceId);
          }
          throwOke("JOURNAL_CODE_VERSION", {
            runId,
            expected: run.codeVersion,
            actual: codeVersion,
          });
        }
        run.codeVersion = codeVersion;
      }
      // Leave status intact — the durable runner parks or continues.
      run.updatedAt = now();
      if (coordinated && lease) {
        run.lockedBy = lease.instanceId;
        run.leaseExpiresAt = now() + (lease.leaseMs ?? JOURNAL_DEFAULT_LEASE_MS);
      }
      const resumeFence =
        coordinated && lease && run.leaseToken !== undefined && run.lockedBy !== undefined
          ? { lockedBy: run.lockedBy, leaseToken: run.leaseToken, now: now() }
          : undefined;
      await options.store.put(cloneRun(run), resumeFence);
      return openSession(run, coordinated);
    },
  };
}

function cloneRun(run: JournalRun): JournalRun {
  return structuredClone(run);
}

/**
 * Bump the fencing token unless this instance already holds a live lease.
 *
 * @param run - Run being claimed
 * @param instanceId - Claimant
 * @param now - Epoch-ms
 * @param leaseMs - Lease duration
 */
function holdLease(run: JournalRun, instanceId: string, now: number, leaseMs: number): void {
  const renew =
    run.lockedBy === instanceId && hasLiveLease(run, now) && run.leaseToken !== undefined;
  if (!renew) run.leaseToken = (run.leaseToken ?? 0) + 1;
  run.lockedBy = instanceId;
  const nextExpiry = now + leaseMs;
  if (run.leaseExpiresAt === undefined || run.leaseExpiresAt < nextExpiry) {
    run.leaseExpiresAt = nextExpiry;
  }
}

/**
 * Reject a write whose lease token is no longer current.
 *
 * @param existing - Stored run, if any
 * @param fence - Caller fence. Omitted on insert and uncoordinated stores.
 */
function assertJournalFence(
  existing: JournalRun | undefined,
  fence: JournalWriteFence | undefined,
): void {
  if (!fence || !existing) return;
  const expired = existing.leaseExpiresAt !== undefined && existing.leaseExpiresAt <= fence.now;
  if (existing.lockedBy !== fence.lockedBy || existing.leaseToken !== fence.leaseToken || expired) {
    throwOke("JOURNAL_STALE_LEASE", { runId: existing.id });
  }
}

/**
 * Header replace that keeps appended entries when the snapshot omitted them.
 *
 * @param existing - Previous row
 * @param incoming - Header snapshot
 */
function mergeJournalPut(existing: JournalRun | undefined, incoming: JournalRun): JournalRun {
  const next = cloneRun(incoming);
  if (existing && incoming.entries.length === 0 && existing.entries.length > 0) {
    (next as { entries: JournalEntry[] }).entries = existing.entries;
  }
  return next;
}

/**
 * Append one entry at `seq`, or no-op when that seq is already stored.
 *
 * @param run - Stored run
 * @param seq - Zero-based position
 * @param entry - JSON-safe entry
 */
function appendStoredEntry(run: JournalRun, seq: number, entry: JournalEntry): void {
  const entries = run.entries as JournalEntry[];
  if (entries.length === seq) {
    entries.push(structuredClone(entry));
    return;
  }
  if (entries.length === seq + 1) return;
  throw new Error(`journal: entry seq ${seq} does not append (have ${entries.length})`);
}

/**
 * JSON snapshot of a journaled value. `Response` becomes a marked object.
 *
 * @param value - Step or effect result
 */
async function journalValue(value: unknown): Promise<unknown> {
  if (typeof Response !== "undefined" && value instanceof Response) {
    const bytes = new Uint8Array(await value.arrayBuffer());
    let body = "";
    for (const byte of bytes) body += String.fromCharCode(byte);
    const headers: Record<string, string> = {};
    value.headers.forEach((header, name) => {
      headers[name] = header;
    });
    return {
      __oke: "response",
      status: value.status,
      statusText: value.statusText,
      headers,
      body: btoa(body),
    };
  }
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
    throwOke("JOURNAL_VALUE_NOT_JSON", { detail: typeof value });
  }
  try {
    return JSON.parse(JSON.stringify(value ?? null)) as unknown;
  } catch {
    throwOke("JOURNAL_VALUE_NOT_JSON", { detail: "unserializable" });
  }
}

/**
 * Rebuild a `Response` from a journal snapshot. Other values pass through.
 *
 * @param value - Stored entry value
 */
function reviveJournalValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as {
    __oke?: string;
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    body?: string;
  };
  if (record.__oke !== "response" || typeof record.body !== "string") return value;
  const binary = atob(record.body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Response(bytes, {
    status: record.status ?? 200,
    statusText: record.statusText,
    headers: record.headers,
  });
}

/**
 * Short label for a journal entry, used in replay errors.
 *
 * @param entry - Stored entry
 */
function entryLabel(entry: JournalEntry): string {
  if (entry.kind === "step") return `step ${entry.name}`;
  if (entry.kind === "sleep") return `sleep ${entry.label}`;
  return `effect ${entry.effectKind} ${entry.resource}`;
}

/**
 * Namespace an opt-in code version so an okengine package version stored by
 * 0.23.1 (`"0.23.1"`) is not compared with an app stamp (`"app:1"`).
 *
 * @param version - Caller version, or unset to skip the check
 */
function stampAppVersion(version: string | undefined): string | undefined {
  if (version === undefined || version.length === 0) return undefined;
  return version.startsWith("app:") ? version : `app:${version}`;
}
