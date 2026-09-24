/**
 * Persisted agent-run event log.
 *
 * The live `fx.run` stream still yields every token. This log coalesces text
 * and tool-argument deltas so a follower can resume without storing one row
 * per token. Structural events are stored as their own rows.
 */

import type { AgUiEvent } from "./events.ts";

/** Persisted rows kept for one run before text deltas stop. */
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
  /** Gate name from the calling Flow. Null means the Flow was public. */
  readonly gate: string | null;
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
  subscribe(
    runId: string,
    afterSeq: number,
    signal?: AbortSignal,
  ): AsyncIterable<StoredAgentEvent>;
}

interface RunBucket {
  header: AgentRunHeader;
  rows: StoredAgentEvent[];
  nextSeq: number;
  truncated: boolean;
  pending?: { event: AgUiEvent; chars: number; since: number };
  listeners: Set<(row: StoredAgentEvent | undefined) => void>;
}

const DELTA_TYPES = new Set(["TEXT_MESSAGE_CONTENT", "TOOL_CALL_ARGS"]);

/**
 * In-memory event log. File and postgres journals keep one of these beside
 * the run store for the life of the process; sweep drops finished runs.
 */
export function createMemoryAgentEventLog(): AgentEventLog {
  const runs = new Map<string, RunBucket>();

  const bucket = (runId: string): RunBucket | undefined => runs.get(runId);

  const push = (run: RunBucket, event: AgUiEvent): number => {
    const seq = run.nextSeq++;
    const row: StoredAgentEvent = { seq, event };
    run.rows.push(row);
    for (const listener of run.listeners) listener(row);
    return seq;
  };

  const storeStructural = (run: RunBucket, event: AgUiEvent): number | undefined => {
    if (run.rows.length >= AGENT_EVENT_CAP && event.type !== "RUN_FINISHED") {
      if (event.type !== "CUSTOM" && !run.truncated) {
        run.truncated = true;
        push(run, { type: "CUSTOM", name: "oke.events.truncated", value: { runId: run.header.runId } });
      }
      if (event.type === "CUSTOM" && event.name === "oke.events.truncated") return undefined;
      if (
        event.type !== "RUN_STARTED" &&
        event.type !== "RUN_ERROR" &&
        event.type !== "STEP_STARTED" &&
        event.type !== "STEP_FINISHED" &&
        event.type !== "TEXT_MESSAGE_START" &&
        event.type !== "TEXT_MESSAGE_END" &&
        event.type !== "TOOL_CALL_START" &&
        event.type !== "TOOL_CALL_END" &&
        event.type !== "TOOL_CALL_RESULT" &&
        event.type !== "RUN_FINISHED"
      ) {
        return undefined;
      }
    }
    return push(run, event);
  };

  const flushPending = (run: RunBucket): number | undefined => {
    const pending = run.pending;
    run.pending = undefined;
    if (!pending) return undefined;
    if (run.rows.length >= AGENT_EVENT_CAP) {
      if (!run.truncated) {
        run.truncated = true;
        return push(run, {
          type: "CUSTOM",
          name: "oke.events.truncated",
          value: { runId: run.header.runId },
        });
      }
      return undefined;
    }
    return push(run, pending.event);
  };

  return {
    async open(header) {
      if (runs.has(header.runId)) return;
      runs.set(header.runId, {
        header,
        rows: [],
        nextSeq: 1,
        truncated: false,
        listeners: new Set(),
      });
    },
    async header(runId) {
      return bucket(runId)?.header;
    },
    async append(runId, event, now) {
      const run = bucket(runId);
      if (!run) return undefined;
      const structural = !DELTA_TYPES.has(event.type);
      if (structural) {
        flushPending(run);
        if (event.type === "RUN_FINISHED") run.header = { ...run.header, finishedAt: now };
        return storeStructural(run, event);
      }
      if (run.rows.length >= AGENT_EVENT_CAP) {
        if (!run.truncated) {
          run.truncated = true;
          flushPending(run);
          return push(run, {
            type: "CUSTOM",
            name: "oke.events.truncated",
            value: { runId },
          });
        }
        return undefined;
      }
      const pending = run.pending;
      if (pending && sameDelta(pending.event, event)) {
        pending.event = mergeDelta(pending.event, event);
        pending.chars += deltaSize(event);
        if (pending.chars >= FLUSH_CHARS || now - pending.since >= FLUSH_MS) {
          return flushPending(run);
        }
        return undefined;
      }
      flushPending(run);
      run.pending = { event, chars: deltaSize(event), since: now };
      if (deltaSize(event) >= FLUSH_CHARS) return flushPending(run);
      return undefined;
    },
    async flush(runId, now) {
      const run = bucket(runId);
      if (!run) return undefined;
      void now;
      return flushPending(run);
    },
    async read(runId, afterSeq) {
      const run = bucket(runId);
      if (!run) return [];
      return run.rows.filter((row) => row.seq > afterSeq);
    },
    async sweep(now, ttlMs = AGENT_EVENT_TTL_MS) {
      let removed = 0;
      for (const [runId, run] of runs) {
        if (run.header.finishedAt !== undefined && now - run.header.finishedAt >= ttlMs) {
          runs.delete(runId);
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
          if (!run) return;
          for (const row of run.rows) {
            if (row.seq > afterSeq) yield row;
          }
          let last = run.rows.at(-1)?.seq ?? afterSeq;
          const queue: StoredAgentEvent[] = [];
          let wake: (() => void) | undefined;
          let done = false;
          const listener = (row: StoredAgentEvent | undefined): void => {
            if (!row) {
              done = true;
            } else if (row.seq > last) {
              queue.push(row);
            }
            wake?.();
          };
          run.listeners.add(listener);
          const onAbort = (): void => {
            done = true;
            wake?.();
          };
          signal?.addEventListener("abort", onAbort);
          try {
            for (;;) {
              while (queue.length > 0) {
                const row = queue.shift()!;
                last = row.seq;
                yield row;
              }
              if (done || signal?.aborted) return;
              if (run.header.finishedAt !== undefined && last >= (run.rows.at(-1)?.seq ?? 0)) return;
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
            }
          } finally {
            run.listeners.delete(listener);
            signal?.removeEventListener("abort", onAbort);
          }
        },
      };
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
