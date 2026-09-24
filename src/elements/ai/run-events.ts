/**
 * Persisted agent-run event log.
 *
 * The live `fx.run` stream still yields every token. This log coalesces text
 * and tool-argument deltas so a follower can resume without storing one row
 * per token. Structural events are stored as their own rows. The journal
 * driver (memory, file, Postgres) keeps the rows so another instance, or a
 * process restart, resumes from the last seq.
 */

import type { AgentEventStore } from "../../kernel/agent-event-store.ts";
import type { AgUiEvent } from "./events.ts";

/** Persisted rows kept for one run before only terminal rows remain. */
export const AGENT_EVENT_CAP = 48;

/** Default lifetime of a finished run's events. */
export const AGENT_EVENT_TTL_MS = 24 * 60 * 60 * 1000;

/** Flush a coalesced delta after this many milliseconds. */
const FLUSH_MS = 100;

/** Flush a coalesced delta after this many characters. */
const FLUSH_CHARS = 1024;

/** One stored event. `seq` is the SSE id. */
export interface StoredAgentEvent {
  readonly seq: number;
  readonly event: AgUiEvent;
}

/** Who may follow the run. */
export interface AgentRunHeader {
  readonly runId: string;
  readonly threadId: string;
  readonly tenant: string | null;
  /** Every non-public gate on the calling Flow. */
  readonly gates: readonly string[];
  /** Starting `auth.userId`. Null when the caller was anonymous. */
  readonly userId: string | null;
  /** Starting operator id. Null when the caller was not an operator. */
  readonly operatorId: string | null;
  readonly finishedAt?: number;
}

/** Journal-backed event log for agent runs. */
export interface AgentEventLog {
  open(header: AgentRunHeader): Promise<void>;
  header(runId: string): Promise<AgentRunHeader | undefined>;
  /**
   * Record one event. Deltas coalesce. Returns the seq once a row is stored,
   * or undefined while a delta is still buffered.
   */
  append(runId: string, event: AgUiEvent, now: number): Promise<number | undefined>;
  /** Force the open delta buffer out. */
  flush(runId: string, now: number): Promise<number | undefined>;
  read(runId: string, afterSeq: number): Promise<readonly StoredAgentEvent[]>;
  /** Delete finished runs older than `ttlMs`. Returns how many runs were removed. */
  sweep(now: number, ttlMs?: number): Promise<number>;
  subscribe(runId: string, afterSeq: number, signal?: AbortSignal): AsyncIterable<StoredAgentEvent>;
  /** Live subscribers still attached to one run. */
  listenerCount(runId: string): number;
}

interface RunBucket {
  header: AgentRunHeader;
  rows: StoredAgentEvent[];
  nextSeq: number;
  pending?: { event: AgUiEvent; chars: number; since: number };
  timer?: ReturnType<typeof setTimeout>;
  listeners: Set<(row: StoredAgentEvent | undefined) => void>;
}

const DELTA_TYPES = new Set(["TEXT_MESSAGE_CONTENT", "TOOL_CALL_ARGS"]);

/**
 * Event log. Pass a journal {@link AgentEventStore} so rows survive restart.
 *
 * @param store - Durable rows. Omit for a process-local log.
 * @param ttlMs - Default sweep lifetime. The scheduler passes this through.
 */
export function createMemoryAgentEventLog(store?: AgentEventStore, ttlMs = AGENT_EVENT_TTL_MS): AgentEventLog {
  const runs = new Map<string, RunBucket>();

  const bucket = (runId: string): RunBucket | undefined => runs.get(runId);

  const kept = (event: AgUiEvent): boolean =>
    event.type === "RUN_FINISHED" || event.type === "RUN_ERROR";

  const trim = (run: RunBucket): void => {
    if (run.rows.length <= AGENT_EVENT_CAP) return;
    run.rows = run.rows.filter((row) => kept(row.event)).slice(-AGENT_EVENT_CAP);
  };

  const push = async (run: RunBucket, event: AgUiEvent): Promise<number> => {
    const seq = run.nextSeq++;
    const row: StoredAgentEvent = { seq, event };
    run.rows.push(row);
    trim(run);
    if (store && run.rows.some((stored) => stored.seq === seq)) {
      await store.append(run.header.runId, row);
    }
    for (const listener of run.listeners) listener(row);
    return seq;
  };

  const clearTimer = (run: RunBucket): void => {
    if (!run.timer) return;
    clearTimeout(run.timer);
    run.timer = undefined;
  };

  const flushPending = async (run: RunBucket): Promise<number | undefined> => {
    clearTimer(run);
    const pending = run.pending;
    run.pending = undefined;
    if (!pending) return undefined;
    return push(run, pending.event);
  };

  const armTimer = (run: RunBucket): void => {
    if (run.timer) return;
    run.timer = setTimeout(() => {
      run.timer = undefined;
      void flushPending(run);
    }, FLUSH_MS);
  };

  return {
    async open(header) {
      if (runs.has(header.runId)) return;
      const loaded = await store?.read(header.runId);
      if (loaded) {
        const rows = loaded.rows.map((row) => ({
          seq: row.seq,
          event: row.event as AgUiEvent,
        }));
        const nextSeq = rows.reduce((max, row) => Math.max(max, row.seq), 0) + 1;
        runs.set(header.runId, {
          header: loaded.header as AgentRunHeader,
          rows,
          nextSeq,
          listeners: new Set(),
        });
        return;
      }
      runs.set(header.runId, {
        header,
        rows: [],
        nextSeq: 1,
        listeners: new Set(),
      });
      await store?.writeHeader(header);
    },
    async header(runId) {
      return bucket(runId)?.header ?? ((await store?.read(runId))?.header as AgentRunHeader | undefined);
    },
    async append(runId, event, now) {
      const run = bucket(runId);
      if (!run) return undefined;
      const structural = !DELTA_TYPES.has(event.type);
      if (structural) {
        await flushPending(run);
        if (
          event.type === "RUN_ERROR" ||
          (event.type === "RUN_FINISHED" && event.outcome?.type !== "interrupt")
        ) {
          run.header = { ...run.header, finishedAt: now };
          await store?.writeHeader(run.header);
        }
        return push(run, event);
      }
      const pending = run.pending;
      if (pending && sameDelta(pending.event, event)) {
        pending.event = mergeDelta(pending.event, event);
        pending.chars += deltaSize(event);
        if (pending.chars >= FLUSH_CHARS || now - pending.since >= FLUSH_MS) {
          return flushPending(run);
        }
        armTimer(run);
        return undefined;
      }
      await flushPending(run);
      run.pending = { event, chars: deltaSize(event), since: now };
      if (deltaSize(event) >= FLUSH_CHARS) return flushPending(run);
      armTimer(run);
      return undefined;
    },
    async flush(runId, _now) {
      const run = bucket(runId);
      if (!run) return undefined;
      return flushPending(run);
    },
    async read(runId, afterSeq) {
      const run = (await loadBucket(runs, store, runId)) ?? bucket(runId);
      if (!run) return [];
      return run.rows.filter((row) => row.seq > afterSeq);
    },
    async sweep(now, ttl = ttlMs) {
      let removed = 0;
      const seen = new Set<string>();
      for (const [runId, run] of runs) {
        seen.add(runId);
        if (run.header.finishedAt !== undefined && now - run.header.finishedAt >= ttl) {
          clearTimer(run);
          runs.delete(runId);
          await store?.remove(runId);
          for (const listener of run.listeners) listener(undefined);
          removed++;
        }
      }
      return removed;
    },
    subscribe(runId, afterSeq, signal) {
      const run = bucket(runId);
      return {
        async *[Symbol.asyncIterator]() {
          const live = run ?? (await loadBucket(runs, store, runId));
          if (!live) return;
          for (const row of live.rows) {
            if (row.seq > afterSeq) yield row;
          }
          let last = live.rows.at(-1)?.seq ?? afterSeq;
          const queue: StoredAgentEvent[] = [];
          let wake: (() => void) | undefined;
          let done = false;
          const listener = (row: StoredAgentEvent | undefined): void => {
            if (!row) {
              done = true;
            } else if (row.seq > last && !queue.some((queued) => queued.seq === row.seq)) {
              queue.push(row);
            }
            wake?.();
          };
          live.listeners.add(listener);
          const onAbort = (): void => {
            done = true;
            wake?.();
          };
          signal?.addEventListener("abort", onAbort, { once: true });
          const poll = store
            ? setInterval(() => {
                void store.read(runId).then((loaded) => {
                  if (!loaded) return;
                  for (const row of loaded.rows) {
                    if (row.seq > last) listener({ seq: row.seq, event: row.event as AgUiEvent });
                  }
                });
              }, 200)
            : undefined;
          try {
            if (signal?.aborted) return;
            for (;;) {
              while (queue.length > 0) {
                const row = queue.shift();
                if (!row) break;
                last = row.seq;
                yield row;
              }
              if (done || signal?.aborted) return;
              if (live.header.finishedAt !== undefined && last >= (live.rows.at(-1)?.seq ?? 0)) return;
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
            }
          } finally {
            if (poll) clearInterval(poll);
            live.listeners.delete(listener);
            signal?.removeEventListener("abort", onAbort);
          }
        },
      };
    },
    listenerCount(runId) {
      return bucket(runId)?.listeners.size ?? 0;
    },
  };
}

async function loadBucket(
  runs: Map<string, RunBucket>,
  store: AgentEventStore | undefined,
  runId: string,
): Promise<RunBucket | undefined> {
  const existing = runs.get(runId);
  if (existing) return existing;
  const loaded = await store?.read(runId);
  if (!loaded) return undefined;
  const rows = loaded.rows.map((row) => ({ seq: row.seq, event: row.event as AgUiEvent }));
  const bucket: RunBucket = {
    header: loaded.header as AgentRunHeader,
    rows,
    nextSeq: rows.reduce((max, row) => Math.max(max, row.seq), 0) + 1,
    listeners: new Set(),
  };
  runs.set(runId, bucket);
  return bucket;
}

function deltaSize(event: AgUiEvent): number {
  if (event.type === "TEXT_MESSAGE_CONTENT" || event.type === "TOOL_CALL_ARGS") {
    return event.delta.length;
  }
  return 0;
}

function sameDelta(left: AgUiEvent, right: AgUiEvent): boolean {
  if (left.type === "TEXT_MESSAGE_CONTENT" && right.type === "TEXT_MESSAGE_CONTENT") {
    return left.messageId === right.messageId;
  }
  if (left.type === "TOOL_CALL_ARGS" && right.type === "TOOL_CALL_ARGS") {
    return left.toolCallId === right.toolCallId;
  }
  return false;
}

function mergeDelta(left: AgUiEvent, right: AgUiEvent): AgUiEvent {
  if (left.type === "TEXT_MESSAGE_CONTENT" && right.type === "TEXT_MESSAGE_CONTENT") {
    return { ...left, delta: left.delta + right.delta };
  }
  if (left.type === "TOOL_CALL_ARGS" && right.type === "TOOL_CALL_ARGS") {
    return { ...left, delta: left.delta + right.delta };
  }
  return right;
}

let activeLog: AgentEventLog | undefined;

/**
 * Install the log the follow route reads. Boot and tests call this.
 *
 * @param log - Active log
 */
export function setAgentEventLog(log: AgentEventLog | undefined): void {
  activeLog = log;
}

/**
 * Log installed by the running AI runtime.
 */
export function getAgentEventLog(): AgentEventLog | undefined {
  return activeLog;
}

/**
 * Sweep the installed log. The scheduler calls this on every tick.
 *
 * @param now - Clock
 * @param ttlMs - Lifetime of a finished run. Defaults to {@link AGENT_EVENT_TTL_MS}.
 */
export async function sweepInstalledAgentEvents(
  now = Date.now(),
  ttlMs = AGENT_EVENT_TTL_MS,
): Promise<number> {
  return (await activeLog?.sweep(now, ttlMs)) ?? 0;
}
