/**
 * Persisted agent-run event log.
 *
 * The live `fx.run` stream still yields every token. This log coalesces text
 * and tool-argument deltas so a follower can resume without storing one row
 * per token. Structural events are stored as their own rows. The journal
 * driver (memory, file, Postgres) keeps the rows so another instance, or a
 * process restart, resumes from the last seq.
 */

import {
  AgentEventDuplicateSeqError,
  type AgentEventStore,
} from "../../kernel/agent-event-store.ts";
import type { AgUiEvent } from "./events.ts";

/** Stored rows per run before deltas stop. Structural events still land. */
export const AGENT_EVENT_CAP = 5_000;

/** Default lifetime of a finished run's events. */
export const AGENT_EVENT_TTL_MS = 24 * 60 * 60 * 1000;

/** Unfinished runs older than this are closed with `RUN_ERROR` and removed. */
export const AGENT_EVENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Name of the one notice stored when deltas stop. */
export const AGENT_EVENTS_TRUNCATED = "oke.events.truncated";

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
  /** Epoch ms the run was opened. */
  readonly openedAt?: number;
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
  sweep(now: number, ttlMs?: number, maxAgeMs?: number): Promise<number>;
  subscribe(runId: string, afterSeq: number, signal?: AbortSignal): AsyncIterable<StoredAgentEvent>;
  /** Live subscribers still attached to one run. */
  listenerCount(runId: string): number;
}

interface RunBucket {
  header: AgentRunHeader;
  rows: StoredAgentEvent[];
  nextSeq: number;
  /** Deltas have already produced the one truncation notice. */
  truncated: boolean;
  /** Store is already at the cap, even when this process has no rows yet. */
  overCap: boolean;
  pending?: { event: AgUiEvent; chars: number; since: number };
  timer?: ReturnType<typeof setTimeout>;
  listeners: Set<(row: StoredAgentEvent | undefined) => void>;
}

/** Cap, TTL, and the age after which an unfinished run is closed. */
export interface AgentEventLogOptions {
  readonly cap?: number;
  readonly ttlMs?: number;
  readonly maxAgeMs?: number;
  /**
   * Claim the right to close one abandoned run.
   * False means another instance holds the journal lease.
   */
  claim?(runId: string): Promise<boolean>;
}

const DELTA_TYPES = new Set(["TEXT_MESSAGE_CONTENT", "TOOL_CALL_ARGS"]);

/**
 * Event log. Pass a journal {@link AgentEventStore} so rows survive restart.
 *
 * Appends for one run are serialized. The opener reads `MAX(seq)` before
 * writing. Past {@link AGENT_EVENT_CAP}, deltas stop and one
 * `oke.events.truncated` is stored. Structural events, interrupts, and the
 * terminal frames stay. History a follower can resume from is not trimmed.
 *
 * @param store - Durable rows. Omit for a process-local log.
 * @param options - Cap, TTL, and max age. A number is the TTL.
 */
export function createMemoryAgentEventLog(
  store?: AgentEventStore,
  options: number | AgentEventLogOptions = AGENT_EVENT_TTL_MS,
): AgentEventLog {
  const opts: AgentEventLogOptions = typeof options === "number" ? { ttlMs: options } : options;
  const cap = opts.cap ?? AGENT_EVENT_CAP;
  const defaultTtl = opts.ttlMs ?? AGENT_EVENT_TTL_MS;
  const defaultMaxAge = opts.maxAgeMs ?? AGENT_EVENT_MAX_AGE_MS;
  const runs = new Map<string, RunBucket>();
  const queues = new Map<string, Promise<unknown>>();

  const bucket = (runId: string): RunBucket | undefined => runs.get(runId);

  const serialized = <T>(runId: string, fn: () => Promise<T>): Promise<T> => {
    const prev = queues.get(runId) ?? Promise.resolve();
    const job = prev.then(fn, fn);
    queues.set(
      runId,
      job.then(
        () => undefined,
        () => undefined,
      ),
    );
    return job;
  };

  const terminal = (event: AgUiEvent): boolean =>
    event.type === "RUN_ERROR" ||
    (event.type === "RUN_FINISHED" && event.outcome?.type !== "interrupt");

  const keepPastCap = (event: AgUiEvent): boolean => {
    if (event.type === "RUN_FINISHED" || event.type === "RUN_ERROR") return true;
    if (event.type === "CUSTOM" && event.name === AGENT_EVENTS_TRUNCATED) return true;
    return !DELTA_TYPES.has(event.type);
  };

  const push = async (run: RunBucket, event: AgUiEvent): Promise<number> => {
    const seq = run.nextSeq++;
    const row: StoredAgentEvent = { seq, event };
    run.rows.push(row);
    await store?.append(run.header.runId, row);
    for (const listener of run.listeners) listener(row);
    return seq;
  };

  const noteTruncation = async (run: RunBucket): Promise<number | undefined> => {
    if (run.truncated) return undefined;
    run.truncated = true;
    return push(run, {
      type: "CUSTOM",
      name: AGENT_EVENTS_TRUNCATED,
      value: { cap },
    });
  };

  const accept = async (run: RunBucket, event: AgUiEvent): Promise<number | undefined> => {
    const delta = DELTA_TYPES.has(event.type);
    if (delta && !keepPastCap(event) && (run.truncated || run.overCap || run.rows.length >= cap)) {
      if (run.truncated) return undefined;
      return noteTruncation(run);
    }
    if ((run.overCap || run.rows.length >= cap) && !keepPastCap(event)) return undefined;
    return push(run, event);
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
    return accept(run, pending.event);
  };

  const armTimer = (run: RunBucket): void => {
    if (run.timer) return;
    run.timer = setTimeout(() => {
      run.timer = undefined;
      void serialized(run.header.runId, () => flushPending(run).then(() => undefined));
    }, FLUSH_MS);
  };

  const drop = async (runId: string): Promise<void> => {
    const run = runs.get(runId);
    if (run) {
      clearTimer(run);
      runs.delete(runId);
      for (const listener of run.listeners) listener(undefined);
    }
    await store?.remove(runId);
  };

  return {
    async open(header) {
      await serialized(header.runId, async () => {
        const max = (await store?.maxSeq(header.runId)) ?? 0;
        const marked = (await store?.truncated(header.runId)) ?? false;
        const existing = runs.get(header.runId);
        if (existing) {
          if (store) {
            existing.nextSeq = max + 1;
            if (marked) existing.truncated = true;
            if (marked || max >= cap) existing.overCap = true;
          }
          return;
        }
        if (max > 0) {
          const stored = await store?.readHeader(header.runId);
          runs.set(header.runId, {
            header: (stored ?? header) as AgentRunHeader,
            rows: [],
            nextSeq: max + 1,
            truncated: marked,
            overCap: marked || max >= cap,
            listeners: new Set(),
          });
          return;
        }
        const opened: AgentRunHeader = { ...header, openedAt: header.openedAt ?? Date.now() };
        runs.set(header.runId, {
          header: opened,
          rows: [],
          nextSeq: 1,
          truncated: false,
          overCap: false,
          listeners: new Set(),
        });
        await store?.writeHeader(opened);
      });
    },
    async header(runId) {
      const live = bucket(runId)?.header;
      if (live) return live;
      return (await store?.readHeader(runId)) as AgentRunHeader | undefined;
    },
    async append(runId, event, now) {
      return serialized(runId, async () => {
        const run = bucket(runId);
        if (!run) return undefined;
        const structural = !DELTA_TYPES.has(event.type);
        if (structural) {
          await flushPending(run);
          if (terminal(event)) {
            run.header = { ...run.header, finishedAt: now };
            await store?.writeHeader(run.header);
          }
          return accept(run, event);
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
      });
    },
    async flush(runId, _now) {
      return serialized(runId, async () => {
        const run = bucket(runId);
        if (!run) return undefined;
        return flushPending(run);
      });
    },
    async read(runId, afterSeq) {
      if (store) {
        const rows = await store.readAfter(runId, afterSeq);
        return rows.map((row) => ({ seq: row.seq, event: row.event as AgUiEvent }));
      }
      const run = bucket(runId);
      if (!run) return [];
      return run.rows.filter((row) => row.seq > afterSeq);
    },
    async sweep(now, ttl = defaultTtl, maxAge = defaultMaxAge) {
      const headers = store
        ? await store.listHeaders()
        : [...runs.values()].map((run) => run.header);
      let removed = 0;
      for (const header of headers) {
        const finished = header.finishedAt;
        if (finished !== undefined && now - finished >= ttl) {
          await drop(header.runId);
          removed++;
          continue;
        }
        const opened = header.openedAt;
        if (finished === undefined && opened !== undefined && now - opened >= maxAge) {
          const claimed = opts.claim
            ? await opts.claim(header.runId)
            : store
              ? await store.claim(header.runId)
              : true;
          if (!claimed) continue;
          try {
            if (!runs.has(header.runId)) await this.open(header as AgentRunHeader);
            await this.append(
              header.runId,
              {
                type: "RUN_ERROR",
                message: "agent events: run exceeded max age",
                code: "AgentEventMaxAge",
              },
              now,
            );
            await drop(header.runId);
            removed++;
          } catch (err) {
            if (err instanceof AgentEventDuplicateSeqError) continue;
            throw err;
          }
        }
      }
      return removed;
    },
    subscribe(runId, afterSeq, signal) {
      const run = bucket(runId);
      return {
        async *[Symbol.asyncIterator]() {
          if (!run && !store) return;
          let last = afterSeq;
          if (store) {
            for (const row of await store.readAfter(runId, afterSeq)) {
              last = row.seq;
              yield { seq: row.seq, event: row.event as AgUiEvent };
            }
          } else if (run) {
            for (const row of run.rows) {
              if (row.seq <= afterSeq) continue;
              last = row.seq;
              yield row;
            }
          }
          if (!run) {
            const known = (await store?.listHeaders())?.some((item) => item.runId === runId);
            if (!known && last === afterSeq) return;
          }
          const live = run;
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
          live?.listeners.add(listener);
          const onAbort = (): void => {
            done = true;
            wake?.();
          };
          signal?.addEventListener("abort", onAbort, { once: true });
          let delay = 200;
          let poll: ReturnType<typeof setTimeout> | undefined;
          const schedule = (): void => {
            if (!store || done) return;
            poll = setTimeout(() => {
              void store.readAfter(runId, last).then((rows) => {
                if (rows.length === 0) delay = Math.min(delay * 2, 2_000);
                else delay = 200;
                for (const row of rows) {
                  listener({ seq: row.seq, event: row.event as AgUiEvent });
                }
                const liveHeader = bucket(runId)?.header;
                if (liveHeader?.finishedAt !== undefined && rows.length === 0) {
                  done = true;
                  wake?.();
                  return;
                }
                schedule();
              });
            }, delay);
          };
          schedule();
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
              if (live?.header.finishedAt !== undefined && queue.length === 0) return;
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
            }
          } finally {
            if (poll) clearTimeout(poll);
            live?.listeners.delete(listener);
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
