/**
 * WebSocket client for `/console/live` — Manifest + run events.
 *
 * Falls back to polling `GET /console/runs` when the socket is closed.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { RunRow } from "@/client.ts";
import { MANIFEST_QUERY_KEY } from "./use-manifest.ts";
import { RUNS_QUERY_KEY } from "./use-runs.ts";

/** Live connection status for the Traces pane indicator. */
export type LiveStatus = "connecting" | "open" | "closed";

/** Message union pushed by the Console live channel. */
type LiveMessage =
  | { readonly type: "manifest"; readonly manifest: unknown }
  | { readonly type: "manifest.diff"; readonly before: unknown; readonly after: unknown }
  | { readonly type: "ping"; readonly at: number }
  | { readonly type: "run"; readonly run: RunRow }
  | { readonly type: "runs.batch"; readonly runs: readonly RunRow[] };

const MAX_LIVE_RUNS = 500;
const POLL_MS = 5_000;

function mergeRun(existing: RunRow[], incoming: RunRow): RunRow[] {
  const idx = existing.findIndex((r) => r.id === incoming.id);
  if (idx === -1) {
    return [incoming, ...existing].slice(0, MAX_LIVE_RUNS);
  }
  const next = existing.slice();
  next[idx] = incoming;
  return next;
}

function mergeRuns(existing: RunRow[], incoming: readonly RunRow[]): RunRow[] {
  let next = existing;
  for (const run of incoming) {
    next = mergeRun(next, run);
  }
  return next;
}

/**
 * Subscribe to the Console live channel and keep React Query caches warm.
 *
 * @param enabled - Whether to connect (authenticated shell only)
 */
export function useConsoleLive(enabled: boolean): LiveStatus {
  const qc = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const statusRef = useRef<LiveStatus>("connecting");

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (!enabled) return;

    let ws: WebSocket | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    const stopPoll = (): void => {
      if (poll !== null) {
        clearInterval(poll);
        poll = null;
      }
    };

    const startPoll = (): void => {
      if (poll !== null) return;
      poll = setInterval(() => {
        void qc.invalidateQueries({ queryKey: RUNS_QUERY_KEY });
      }, POLL_MS);
    };

    const applyMessage = (msg: LiveMessage): void => {
      if (msg.type === "manifest") {
        qc.setQueryData(MANIFEST_QUERY_KEY, msg.manifest);
        return;
      }
      if (msg.type === "manifest.diff") {
        qc.setQueryData(MANIFEST_QUERY_KEY, msg.after);
        return;
      }
      if (msg.type === "run") {
        qc.setQueryData<RunRow[]>(RUNS_QUERY_KEY, (old) => mergeRun(old ?? [], msg.run));
        return;
      }
      if (msg.type === "runs.batch") {
        qc.setQueryData<RunRow[]>(RUNS_QUERY_KEY, (old) => mergeRuns(old ?? [], msg.runs));
        return;
      }
      // ping — keepalive, no cache work
    };

    const connect = (): void => {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${window.location.host}/console/live`);
      setStatus("connecting");

      ws.onopen = () => {
        setStatus("open");
        stopPoll();
      };
      ws.onmessage = (event) => {
        try {
          applyMessage(JSON.parse(String(event.data)) as LiveMessage);
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => {
        setStatus("closed");
        startPoll();
        if (!closed) {
          // Reconnect after a beat.
          setTimeout(() => {
            if (!closed) connect();
          }, 2_000);
        }
      };
      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      closed = true;
      stopPoll();
      ws?.close();
    };
  }, [enabled, qc]);

  return status;
}
