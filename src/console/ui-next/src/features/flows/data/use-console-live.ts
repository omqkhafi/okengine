/**
 * WebSocket client for `/console/live` — Manifest + run events.
 *
 * Falls back to polling `GET /console/runs` when the socket is closed.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { runsList, type RunRow } from "@/client.ts";
import {
  createConsoleLiveSession,
  mergeRun,
  mergeRuns,
  pollConsoleRuns,
  type LiveMessage,
  type LiveStatus,
  type LiveWebSocketConstructor,
} from "./console-live-session.ts";
import { MANIFEST_QUERY_KEY } from "./use-manifest.ts";
import { RUNS_QUERY_KEY } from "./use-runs.ts";

export type { LiveStatus } from "./console-live-session.ts";
export { CONSOLE_LIVE_POLL_MS, CONSOLE_LIVE_RECONNECT_MS } from "./console-live-session.ts";

/**
 * Subscribe to the Console live channel and keep React Query caches warm.
 *
 * @param enabled - Whether to connect (authenticated shell only)
 */
export function useConsoleLive(enabled: boolean): LiveStatus {
  const qc = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>("connecting");

  useEffect(() => {
    if (!enabled) return;

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

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const session = createConsoleLiveSession({
      // Browser WebSocket `this` typing is stricter than the injectable surface.
      WebSocket: globalThis.WebSocket as unknown as LiveWebSocketConstructor,
      host: window.location.host,
      protocol,
      setStatus,
      onMessage: applyMessage,
      onPoll: () => {
        void pollConsoleRuns(runsList, (runs) => {
          qc.setQueryData(RUNS_QUERY_KEY, runs);
        });
      },
    });
    session.start();

    return () => {
      session.stop();
    };
  }, [enabled, qc]);

  return status;
}
