/**
 * Runs query for the Traces pane — `GET /console/runs` initial load.
 * Live updates merge in via `useConsoleLive`; this stays the resync source.
 */

import { useQuery } from "@tanstack/react-query";
import { runsList, type RunRow } from "@/client.ts";

/** React Query key for the runs list. */
export const RUNS_QUERY_KEY = ["console.runs.list"] as const;

/**
 * Fetch recent wide events (initial load / resync).
 */
export function useRuns() {
  return useQuery({
    queryKey: RUNS_QUERY_KEY,
    queryFn: async (): Promise<RunRow[]> => {
      const res = await runsList();
      if (res.error) throw new Error(res.error.code);
      return res.data?.runs ?? [];
    },
  });
}
