/**
 * Console live channel session — WebSocket + polling fallback (pure controller).
 *
 * The React hook wires this to React Query; unit tests drive it with a fake
 * WebSocket and injectable timers.
 */

import type { RunRow } from "@/client.ts";

/** Live connection status for the Traces pane indicator. */
export type LiveStatus = "connecting" | "open" | "closed";

/** Message union pushed by the Console live channel. */
export type LiveMessage =
  | { readonly type: "manifest"; readonly manifest: unknown }
  | { readonly type: "manifest.diff"; readonly before: unknown; readonly after: unknown }
  | { readonly type: "ping"; readonly at: number }
  | { readonly type: "run"; readonly run: RunRow }
  | { readonly type: "runs.batch"; readonly runs: readonly RunRow[] };

/** Documented poll interval when the live socket is closed. */
export const CONSOLE_LIVE_POLL_MS = 5_000;

/** Delay before a reconnect attempt after the socket closes. */
export const CONSOLE_LIVE_RECONNECT_MS = 2_000;

const MAX_LIVE_RUNS = 500;

/**
 * Merge one projected run into the runs buffer (newest-first, capped).
 *
 * @param existing - Current buffer
 * @param incoming - Live or polled run
 */
export function mergeRun(existing: RunRow[], incoming: RunRow): RunRow[] {
  const idx = existing.findIndex((r) => r.id === incoming.id);
  if (idx === -1) {
    return [incoming, ...existing].slice(0, MAX_LIVE_RUNS);
  }
  const next = existing.slice();
  next[idx] = incoming;
  return next;
}

/**
 * Merge a batch of projected runs into the runs buffer.
 *
 * @param existing - Current buffer
 * @param incoming - Batch from `runs.batch`
 */
export function mergeRuns(existing: RunRow[], incoming: readonly RunRow[]): RunRow[] {
  let next = existing;
  for (const run of incoming) {
    next = mergeRun(next, run);
  }
  return next;
}

/** Minimal WebSocket surface the session needs (browser or fake). */
export interface LiveWebSocket {
  onopen: ((ev: Event) => unknown) | null;
  onclose: ((ev: CloseEvent) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
  onmessage: ((ev: MessageEvent) => unknown) | null;
  close(): void;
}

/**
 * Injectable WebSocket constructor.
 * Browser `WebSocket` is assigned via cast — its `this` typing is stricter.
 */
export type LiveWebSocketConstructor = new (
  url: string | URL,
  protocols?: string | string[],
) => LiveWebSocket;

/** Dependencies for {@link createConsoleLiveSession}. */
export interface ConsoleLiveSessionDeps {
  readonly WebSocket: LiveWebSocketConstructor;
  readonly host: string;
  readonly protocol: "ws:" | "wss:";
  readonly setStatus: (status: LiveStatus) => void;
  readonly onMessage: (msg: LiveMessage) => void;
  /** Called on each poll tick while the socket is closed (invalidate runs). */
  readonly onPoll: () => void;
  readonly pollMs?: number;
  readonly reconnectMs?: number;
  readonly setTimeout?: typeof setTimeout;
  readonly clearTimeout?: typeof clearTimeout;
  readonly setInterval?: typeof setInterval;
  readonly clearInterval?: typeof clearInterval;
}

/** Handle returned by {@link createConsoleLiveSession}. */
export interface ConsoleLiveSession {
  /** Open the first connection. */
  start(): void;
  /** Tear down socket, poll, and pending reconnect. */
  stop(): void;
}

/**
 * Closed-socket poll tick — fetch `GET /console/runs` and push into cache.
 *
 * @param list - Client `runsList` (or a test double)
 * @param setRuns - Write the projected runs into the query cache
 */
export async function pollConsoleRuns(
  list: () => Promise<{
    readonly error?: unknown;
    readonly data?: { readonly runs?: readonly RunRow[] } | null;
  }>,
  setRuns: (runs: RunRow[]) => void,
): Promise<void> {
  const res = await list();
  if (res.error) return;
  setRuns([...(res.data?.runs ?? [])]);
}

/**
 * Create a live session that connects to `/console/live` and falls back to
 * polling when the socket closes.
 *
 * @param deps - WebSocket, status, message, poll, timers
 */
export function createConsoleLiveSession(deps: ConsoleLiveSessionDeps): ConsoleLiveSession {
  const pollMs = deps.pollMs ?? CONSOLE_LIVE_POLL_MS;
  const reconnectMs = deps.reconnectMs ?? CONSOLE_LIVE_RECONNECT_MS;
  const setTimeoutFn = deps.setTimeout ?? setTimeout;
  const clearTimeoutFn = deps.clearTimeout ?? clearTimeout;
  const setIntervalFn = deps.setInterval ?? setInterval;
  const clearIntervalFn = deps.clearInterval ?? clearInterval;

  let ws: LiveWebSocket | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = true;

  const stopPoll = (): void => {
    if (poll !== null) {
      clearIntervalFn(poll);
      poll = null;
    }
  };

  const startPoll = (): void => {
    if (poll !== null) return;
    poll = setIntervalFn(() => {
      deps.onPoll();
    }, pollMs);
  };

  const connect = (): void => {
    if (stopped) return;
    if (reconnectTimer !== null) {
      clearTimeoutFn(reconnectTimer);
      reconnectTimer = null;
    }

    const url = `${deps.protocol}//${deps.host}/console/live`;
    ws = new deps.WebSocket(url);
    deps.setStatus("connecting");

    ws.onopen = () => {
      if (stopped) return;
      deps.setStatus("open");
      stopPoll();
    };

    ws.onmessage = (event) => {
      if (stopped) return;
      try {
        deps.onMessage(JSON.parse(String(event.data)) as LiveMessage);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      if (stopped) return;
      deps.setStatus("closed");
      startPoll();
      reconnectTimer = setTimeoutFn(() => {
        reconnectTimer = null;
        if (!stopped) connect();
      }, reconnectMs);
    };

    ws.onerror = () => {
      ws?.close();
    };
  };

  return {
    start() {
      stopped = false;
      connect();
    },
    stop() {
      stopped = true;
      stopPoll();
      if (reconnectTimer !== null) {
        clearTimeoutFn(reconnectTimer);
        reconnectTimer = null;
      }
      ws?.close();
      ws = null;
    },
  };
}
