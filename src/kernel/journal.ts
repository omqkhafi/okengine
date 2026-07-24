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

/** Status of a durable run. */
export type JournalRunStatus =
  | "running"
  | "sleeping"
  | "completed"
  | "failed";

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
export type JournalEntry =
  | JournalStepEntry
  | JournalSleepEntry
  | JournalEffectEntry;

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
  readonly createdAt: number;
  updatedAt: number;
}

/**
 * Thrown inside a durable body when a sleep has not yet elapsed.
 * The runner catches this and parks the run as `sleeping`.
 */
export class JournalSuspend extends Error {
  readonly wakeAt: number;
  readonly label: string;

  /**
   * @param label - Sleep label
   * @param wakeAt - Absolute wake epoch-ms
   */
  constructor(label: string, wakeAt: number) {
    super(`journal suspend: sleep "${label}" until ${wakeAt}`);
    this.name = "JournalSuspend";
    this.label = label;
    this.wakeAt = wakeAt;
  }
}

/** Persistence backend for journal runs. */
export interface JournalStore {
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

/** In-memory journal store. */
export function createMemoryJournalStore(
  seed?: readonly JournalRun[],
): JournalStore {
  const runs = new Map<string, JournalRun>();
  for (const r of seed ?? []) {
    runs.set(r.id, cloneRun(r));
  }
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
    await Bun.write(
      path,
      JSON.stringify({ runs: [...map.values()] }, null, 2),
    );
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
  };
}

/** Options for {@link createJournal}. */
export interface CreateJournalOptions {
  /** Persistence backend. */
  readonly store: JournalStore;
  /** Clock for timestamps. */
  readonly now?: () => number;
  /** Id factory (defaults to UUID). */
  readonly id?: () => string;
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
  sleep(
    label: string,
    duration: string,
    parseMs: (duration: string) => number,
  ): Promise<void>;
  /**
   * Journal an arbitrary fx effect (replay returns recorded value).
   *
   * @param effectKind - Effect kind key
   * @param resource - Resource ref
   * @param execute - Side-effecting body
   */
  effect<T>(
    effectKind: string,
    resource: string,
    execute: () => T | Promise<T>,
  ): Promise<T>;
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

  function openSession(run: JournalRun): JournalSession {
    /** Next entry index to consume on replay. */
    let cursor = 0;

    async function persist(): Promise<void> {
      run.updatedAt = now();
      await options.store.put(cloneRun(run));
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
          if (
            e.kind === "effect" &&
            e.effectKind === effectKind &&
            e.resource === resource
          ) {
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
      async commit(status, patch) {
        run.status = status;
        if (patch?.wakeAt !== undefined) run.wakeAt = patch.wakeAt;
        if (patch?.output !== undefined) run.output = patch.output;
        if (patch?.error !== undefined) run.error = patch.error;
        if (status === "completed" || status === "failed") {
          delete run.wakeAt;
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
      await options.store.put(cloneRun(run));
      return openSession(run);
    },
    async resume(runId) {
      const run = await options.store.get(runId);
      if (!run) {
        throw new Error(`journal: run "${runId}" not found`);
      }
      // Leave status intact — the durable runner parks or continues.
      run.updatedAt = now();
      await options.store.put(cloneRun(run));
      return openSession(run);
    },
  };
}

/**
 * True when `err` is a {@link JournalSuspend}.
 *
 * @param err - Unknown
 */
export function isJournalSuspend(err: unknown): err is JournalSuspend {
  return err instanceof JournalSuspend;
}

function cloneRun(run: JournalRun): JournalRun {
  return structuredClone(run);
}
