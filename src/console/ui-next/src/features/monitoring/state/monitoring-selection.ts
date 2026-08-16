/**
 * Monitoring page URL search — window, selected error group, open run.
 */

import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";
import {
  DEFAULT_MONITORING_WINDOW,
  parseMonitoringWindow,
  type MonitoringWindow,
} from "../lib/window-stats.ts";

/** Right-pane mode on `/monitoring`. */
export type MonitoringView = "metrics" | "query";

/** Search params for `/monitoring`. */
export interface MonitoringSearch {
  readonly run?: string;
  readonly window?: MonitoringWindow;
  readonly error?: string;
  readonly q?: string;
  readonly view?: MonitoringView;
}

/**
 * Validate Monitoring search params from the router.
 *
 * @param search - Raw search object
 */
export function validateMonitoringSearch(search: Record<string, unknown>): MonitoringSearch {
  const run = typeof search.run === "string" && search.run.length > 0 ? search.run : undefined;
  const window = parseMonitoringWindow(search.window);
  const error =
    typeof search.error === "string" && search.error.length > 0 ? search.error : undefined;
  const q = typeof search.q === "string" && search.q.length > 0 ? search.q : undefined;
  const view = search.view === "query" ? "query" : undefined;
  return {
    ...(run !== undefined ? { run } : {}),
    ...(window !== DEFAULT_MONITORING_WINDOW ? { window } : {}),
    ...(error !== undefined ? { error } : {}),
    ...(q !== undefined ? { q } : {}),
    ...(view !== undefined ? { view } : {}),
  };
}

/**
 * Read + write the Monitoring page selection from the URL.
 */
export function useMonitoringSelection() {
  const search = useSearch({ strict: false }) as MonitoringSearch;
  const navigate = useNavigate();

  const selectedRunId = typeof search.run === "string" ? search.run : null;
  const window = parseMonitoringWindow(search.window);
  const selectedErrorKey = typeof search.error === "string" ? search.error : null;
  const query = typeof search.q === "string" ? search.q : "";
  const view: MonitoringView = search.view === "query" ? "query" : "metrics";

  const patch = useCallback(
    (next: Partial<MonitoringSearch>) => {
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => validateMonitoringSearch({ ...prev, ...next }),
        replace: true,
      });
    },
    [navigate],
  );

  const setSelectedRun = useCallback(
    (run: string | null) => {
      patch({ run: run ?? undefined });
    },
    [patch],
  );

  const setWindow = useCallback(
    (next: MonitoringWindow) => {
      patch({ window: next });
    },
    [patch],
  );

  const setSelectedError = useCallback(
    (error: string | null, run?: string | null) => {
      patch({
        error: error ?? undefined,
        ...(run !== undefined ? { run: run ?? undefined } : {}),
      });
    },
    [patch],
  );

  const setQuery = useCallback(
    (q: string) => {
      patch({ q: q.length > 0 ? q : undefined });
    },
    [patch],
  );

  const setView = useCallback(
    (next: MonitoringView) => {
      patch({ view: next === "metrics" ? undefined : next });
    },
    [patch],
  );

  return {
    selectedRunId,
    window,
    selectedErrorKey,
    query,
    view,
    setSelectedRun,
    setWindow,
    setSelectedError,
    setQuery,
    setView,
  };
}
