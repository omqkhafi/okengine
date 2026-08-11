/**
 * Flow split-view selection state — URL-backed via TanStack Router search.
 *
 * `run` selects a trace; `flow` seeds a graph/Traces filter; `follow`
 * controls the graph follow-camera.
 */

import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

/** Search params accepted by the `/flows` route. */
export interface FlowsSearch {
  readonly run?: string;
  /** Structural deep-link — seeds graph filter + fitView for this flow id. */
  readonly flow?: string;
  readonly follow?: boolean;
}

/** Validate raw router search into {@link FlowsSearch}. */
export function validateFlowsSearch(search: Record<string, unknown>): FlowsSearch {
  const run = typeof search.run === "string" && search.run.length > 0 ? search.run : undefined;
  const flow = typeof search.flow === "string" && search.flow.length > 0 ? search.flow : undefined;
  const follow = search.follow === false || search.follow === "false" ? false : undefined;
  return {
    ...(run !== undefined ? { run } : {}),
    ...(flow !== undefined ? { flow } : {}),
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
  const selectedFlowId = typeof search.flow === "string" ? search.flow : null;
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

  const setSelectedFlow = useCallback(
    (flow: string | null) => {
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          flow: flow ?? undefined,
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

  return {
    selectedRunId,
    selectedFlowId,
    follow,
    setSelectedRun,
    setSelectedFlow,
    setFollow,
  };
}
