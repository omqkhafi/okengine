/**
 * Flow split-view selection state — URL-backed via TanStack Router search.
 *
 * `run` selects a trace; `follow` controls the graph follow-camera.
 */

import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

/** Search params accepted by the `/flows` route. */
export interface FlowsSearch {
  readonly run?: string;
  readonly follow?: boolean;
}

/** Validate raw router search into {@link FlowsSearch}. */
export function validateFlowsSearch(search: Record<string, unknown>): FlowsSearch {
  const run = typeof search.run === "string" && search.run.length > 0 ? search.run : undefined;
  const follow = search.follow === false || search.follow === "false" ? false : undefined;
  return {
    ...(run !== undefined ? { run } : {}),
    ...(follow !== undefined ? { follow } : {}),
  };
}

/**
 * Read + write the Flow page selection from the URL.
 */
export function useFlowsSelection() {
  const search = useSearch({ strict: false }) as FlowsSearch;
  const navigate = useNavigate();

  const selectedRunId = typeof search.run === "string" ? search.run : null;
  const follow = search.follow !== false;

  const setSelectedRun = useCallback(
    (run: string | null) => {
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          run: run ?? undefined,
        }),
        replace: true,
      });
    },
    [navigate],
  );

  const setFollow = useCallback(
    (next: boolean) => {
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          follow: next ? undefined : false,
        }),
        replace: true,
      });
    },
    [navigate],
  );

  return { selectedRunId, follow, setSelectedRun, setFollow };
}
