/**
 * React Query mutation for `POST /console/runs/query`.
 */

import { useMutation } from "@tanstack/react-query";
import { runsQuery, type RunsQueryInput, type RunsQueryResult } from "@/client.ts";

function toError(res: {
  error?: { code: string; message?: string; data?: unknown } | null;
}): Error | null {
  if (!res.error) return null;
  const data = res.error.data;
  const fromData =
    data && typeof data === "object" && "reason" in data && typeof data.reason === "string"
      ? data.reason
      : null;
  const err = new Error(fromData ?? res.error.message ?? res.error.code) as Error & {
    code: string;
    data?: unknown;
  };
  err.code = res.error.code;
  err.data = res.error.data;
  return err;
}

/**
 * Run a sandboxed SQL statement against persisted runs.
 */
export function useRunsQuery() {
  return useMutation({
    mutationFn: async (input: RunsQueryInput): Promise<RunsQueryResult> => {
      const res = await runsQuery(input);
      const err = toError(res);
      if (err) throw err;
      if (!res.data) throw new Error("Empty runs query");
      return res.data;
    },
  });
}
