/**
 * Observability page URL search — window, selected error group, open run.
 */

import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";
import {
  DEFAULT_OBSERVABILITY_WINDOW,
  parseObservabilityWindow,
  type ObservabilityWindow,
} from "../lib/window-stats.ts";

/** Right-pane mode on `/observability`. */
export type ObservabilityView = "metrics" | "query";

/** Search params for `/observability`. */
export interface ObservabilitySearch {
  readonly run?: string;
  readonly window?: ObservabilityWindow;
  readonly error?: string;
  readonly q?: string;
  readonly view?: ObservabilityView;
}

/**
 * Validate Observability search params from the router.
 *
 * @param search - Raw search object
 */
export function validateObservabilitySearch(search: Record<string, unknown>): ObservabilitySearch {
  const run = typeof search.run === "string" && search.run.length > 0 ? search.run : undefined;
  const window = parseObservabilityWindow(search.window);
  const error =
    typeof search.error === "string" && search.error.length > 0 ? search.error : undefined;
  const q = typeof search.q === "string" && search.q.length > 0 ? search.q : undefined;
  const view = search.view === "query" ? "query" : undefined;
  return {
    ...(run !== undefined ? { run } : {}),
    ...(window !== DEFAULT_OBSERVABILITY_WINDOW ? { window } : {}),
    ...(error !== undefined ? { error } : {}),
    ...(q !== undefined ? { q } : {}),
    ...(view !== undefined ? { view } : {}),
  };
}

/**
 * Read + write the Observability page selection from the URL.
 */
export function useObservabilitySelection() {
  const search = useSearch({ strict: false }) as ObservabilitySearch;
  const navigate = useNavigate();

  const selectedRunId = typeof search.run === "string" ? search.run : null;
  const window = parseObservabilityWindow(search.window);
  const selectedErrorKey = typeof search.error === "string" ? search.error : null;
  const query = typeof search.q === "string" ? search.q : "";
  const view: ObservabilityView = search.view === "query" ? "query" : "metrics";

  const patch = useCallback(
    (next: Partial<ObservabilitySearch>) => {
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) =>
          validateObservabilitySearch({ ...prev, ...next }),
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
    (next: ObservabilityWindow) => {
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
    (next: ObservabilityView) => {
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
