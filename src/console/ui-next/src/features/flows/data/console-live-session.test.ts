/**
 * Console live session — connecting → open, closed + POLL_MS fallback.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  CONSOLE_LIVE_POLL_MS,
  CONSOLE_LIVE_RECONNECT_MS,
  createConsoleLiveSession,
  mergeRun,
  pollConsoleRuns,
  type LiveMessage,
  type LiveStatus,
  type LiveWebSocket,
  type LiveWebSocketConstructor,
} from "./console-live-session.ts";
import type { RunRow } from "@/client.ts";

function runRow(partial: Partial<RunRow> & Pick<RunRow, "id" | "flow">): RunRow {
  return {
    parentId: null,
    unit: null,
    trigger: "http",
    plane: "user",
    tenant: null,
    principal: null,
    gates: [],
    cache: "none",
    replica: null,
    replicaLagMs: null,
    cost: null,
    promptVersion: null,
    buildVersion: null,
    startedAt: 1,
    endedAt: 2,
    durationMs: 1,
    error: null,
    sampled: "sample",
    effects: [],
    logs: [],
    dimensions: {},
    input: null,
    ...partial,
  };
}

class FakeWebSocket implements LiveWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: ((ev: Event) => unknown) | null = null;
  onclose: ((ev: CloseEvent) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  readonly url: string;
  closed = false;

  constructor(url: string | URL) {
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }

  open(): void {
    this.onopen?.(new Event("open"));
  }

  emit(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.(new CloseEvent("close"));
  }

  errorThenClose(): void {
    this.onerror?.(new Event("error"));
  }
}

describe("mergeRun", () => {
  test("prepends new runs and updates existing by id", () => {
    const a = runRow({ id: "a", flow: "demo.a", startedAt: 1 });
    const b = runRow({ id: "b", flow: "demo.b", startedAt: 2 });
    const merged = mergeRun([a], b);
    expect(merged.map((r) => r.id)).toEqual(["b", "a"]);

    const updated = mergeRun(merged, runRow({ id: "a", flow: "demo.a", durationMs: 9 }));
    expect(updated[1]?.durationMs).toBe(9);
  });
});

describe("pollConsoleRuns", () => {
  test("calls the GET /console/runs client and writes projected runs", async () => {
    let listCalls = 0;
    const cached: RunRow[][] = [];
    const row = runRow({ id: "polled", flow: "bookings.create" });

    await pollConsoleRuns(
      async () => {
        listCalls += 1;
        return { data: { runs: [row] } };
      },
      (runs) => {
        cached.push(runs);
      },
    );

    expect(listCalls).toBe(1);
    expect(cached).toEqual([[row]]);
  });

  test("skips cache write when the list call errors", async () => {
    const cached: RunRow[][] = [];
    await pollConsoleRuns(async () => ({ error: { code: "AuthFailed" } }), (runs) => {
      cached.push(runs);
    });
    expect(cached).toEqual([]);
  });
});

describe("createConsoleLiveSession", () => {
  const timers: {
    intervals: Array<{ id: number; ms: number; fn: () => void }>;
    timeouts: Array<{ id: number; ms: number; fn: () => void }>;
    nextId: number;
  } = { intervals: [], timeouts: [], nextId: 1 };

  const setIntervalFn = ((fn: () => void, ms: number) => {
    const id = timers.nextId++;
    timers.intervals.push({ id, ms, fn });
    return id as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;

  const clearIntervalFn = ((id: ReturnType<typeof setInterval>) => {
    timers.intervals = timers.intervals.filter((t) => t.id !== (id as unknown as number));
  }) as typeof clearInterval;

  const setTimeoutFn = ((fn: () => void, ms: number) => {
    const id = timers.nextId++;
    timers.timeouts.push({ id, ms, fn });
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  const clearTimeoutFn = ((id: ReturnType<typeof setTimeout>) => {
    timers.timeouts = timers.timeouts.filter((t) => t.id !== (id as unknown as number));
  }) as typeof clearTimeout;

  afterEach(() => {
    FakeWebSocket.instances = [];
    timers.intervals = [];
    timers.timeouts = [];
    timers.nextId = 1;
  });

  function tickIntervals(ms: number): void {
    for (const t of [...timers.intervals]) {
      if (t.ms === ms) t.fn();
    }
  }

  function flushTimeouts(ms: number): void {
    const due = timers.timeouts.filter((t) => t.ms === ms);
    timers.timeouts = timers.timeouts.filter((t) => t.ms !== ms);
    for (const t of due) t.fn();
  }

  test("status is connecting then open on successful WS connect", () => {
    const statuses: LiveStatus[] = [];
    const messages: LiveMessage[] = [];
    const polls: number[] = [];

    const session = createConsoleLiveSession({
      WebSocket: FakeWebSocket as unknown as LiveWebSocketConstructor,
      host: "127.0.0.1:6538",
      protocol: "ws:",
      setStatus: (s) => statuses.push(s),
      onMessage: (m) => messages.push(m),
      onPoll: () => polls.push(Date.now()),
      setInterval: setIntervalFn,
      clearInterval: clearIntervalFn,
      setTimeout: setTimeoutFn,
      clearTimeout: clearTimeoutFn,
    });

    session.start();
    expect(statuses).toEqual(["connecting"]);
    expect(FakeWebSocket.instances[0]?.url).toBe("ws://127.0.0.1:6538/console/live");

    FakeWebSocket.instances[0]!.open();
    expect(statuses).toEqual(["connecting", "open"]);
    expect(polls).toEqual([]);
    expect(timers.intervals).toEqual([]);

    FakeWebSocket.instances[0]!.emit({
      type: "run",
      run: runRow({ id: "r1", flow: "bookings.create" }),
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.type).toBe("run");

    session.stop();
  });

  test("falls back to closed + starts POLL_MS interval when the socket closes", async () => {
    const statuses: LiveStatus[] = [];
    let listCalls = 0;

    const session = createConsoleLiveSession({
      WebSocket: FakeWebSocket as unknown as LiveWebSocketConstructor,
      host: "console.test",
      protocol: "ws:",
      setStatus: (s) => statuses.push(s),
      onMessage: () => {},
      onPoll: () => {
        // Same wiring as useConsoleLive: poll tick → GET /console/runs.
        void pollConsoleRuns(
          async () => {
            listCalls += 1;
            return { data: { runs: [] } };
          },
          () => {},
        );
      },
      pollMs: CONSOLE_LIVE_POLL_MS,
      reconnectMs: CONSOLE_LIVE_RECONNECT_MS,
      setInterval: setIntervalFn,
      clearInterval: clearIntervalFn,
      setTimeout: setTimeoutFn,
      clearTimeout: clearTimeoutFn,
    });

    session.start();
    FakeWebSocket.instances[0]!.open();
    FakeWebSocket.instances[0]!.close();

    expect(statuses.at(-1)).toBe("closed");
    expect(timers.intervals).toHaveLength(1);
    expect(timers.intervals[0]?.ms).toBe(CONSOLE_LIVE_POLL_MS);
    expect(CONSOLE_LIVE_POLL_MS).toBe(5_000);

    tickIntervals(CONSOLE_LIVE_POLL_MS);
    tickIntervals(CONSOLE_LIVE_POLL_MS);
    await Promise.resolve();
    await Promise.resolve();
    expect(listCalls).toBe(2);

    session.stop();
    expect(timers.intervals).toHaveLength(0);
  });

  test("socket error closes the socket and enters the closed/poll path", () => {
    const statuses: LiveStatus[] = [];
    let pollCount = 0;

    const session = createConsoleLiveSession({
      WebSocket: FakeWebSocket as unknown as LiveWebSocketConstructor,
      host: "console.test",
      protocol: "ws:",
      setStatus: (s) => statuses.push(s),
      onMessage: () => {},
      onPoll: () => {
        pollCount += 1;
      },
      setInterval: setIntervalFn,
      clearInterval: clearIntervalFn,
      setTimeout: setTimeoutFn,
      clearTimeout: clearTimeoutFn,
    });

    session.start();
    FakeWebSocket.instances[0]!.errorThenClose();

    expect(statuses).toContain("closed");
    expect(timers.intervals[0]?.ms).toBe(CONSOLE_LIVE_POLL_MS);
    tickIntervals(CONSOLE_LIVE_POLL_MS);
    expect(pollCount).toBe(1);

    // Reconnect is scheduled at the documented delay.
    expect(timers.timeouts.some((t) => t.ms === CONSOLE_LIVE_RECONNECT_MS)).toBe(true);
    const before = FakeWebSocket.instances.length;
    flushTimeouts(CONSOLE_LIVE_RECONNECT_MS);
    expect(FakeWebSocket.instances.length).toBe(before + 1);
    expect(statuses.at(-1)).toBe("connecting");

    session.stop();
  });

  test("stops poll when the socket reopens", () => {
    const statuses: LiveStatus[] = [];
    let pollCount = 0;

    const session = createConsoleLiveSession({
      WebSocket: FakeWebSocket as unknown as LiveWebSocketConstructor,
      host: "console.test",
      protocol: "ws:",
      setStatus: (s) => statuses.push(s),
      onMessage: () => {},
      onPoll: () => {
        pollCount += 1;
      },
      setInterval: setIntervalFn,
      clearInterval: clearIntervalFn,
      setTimeout: setTimeoutFn,
      clearTimeout: clearTimeoutFn,
    });

    session.start();
    FakeWebSocket.instances[0]!.close();
    expect(timers.intervals).toHaveLength(1);

    flushTimeouts(CONSOLE_LIVE_RECONNECT_MS);
    const reopened = FakeWebSocket.instances.at(-1)!;
    reopened.open();

    expect(statuses.at(-1)).toBe("open");
    expect(timers.intervals).toHaveLength(0);
    tickIntervals(CONSOLE_LIVE_POLL_MS);
    expect(pollCount).toBe(0);

    session.stop();
  });
});
