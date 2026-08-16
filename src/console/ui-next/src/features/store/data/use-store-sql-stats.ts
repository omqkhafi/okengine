/**
 * React Query wrapper for `QUERY /console/store/sql/stats`.
 */

import { useQuery } from "@tanstack/react-query";
import { storeSqlStats, type StoreSqlStatsInput, type StoreSqlStatsResult } from "@/client.ts";

/** React Query key for SQL stats. */
export const STORE_SQL_STATS_KEY = ["console.store.sql.stats"] as const;

function toError(res: {
  error?: { code: string; message?: string; data?: unknown } | null;
}): Error | null {
  if (!res.error) return null;
  const data = res.error.data;
  const reason =
    data && typeof data === "object" && "reason" in data && typeof data.reason === "string"
      ? data.reason
      : null;
  const err = new Error(reason ?? res.error.message ?? res.error.code) as Error & {
    code: string;
    data?: unknown;
  };
  err.code = res.error.code;
  err.data = res.error.data;
  return err;
}

/**
 * Fetch pg_stat_statements + KPIs for a SQL store.
 *
 * @param input - Store ref (disabled when null)
 */
export function useStoreSqlStats(input: StoreSqlStatsInput | null) {
  return useQuery({
    queryKey: [...STORE_SQL_STATS_KEY, input],
    enabled: input !== null,
    queryFn: async (): Promise<StoreSqlStatsResult> => {
      if (!input) throw new Error("Missing store ref");
      const res = await storeSqlStats(input);
      const err = toError(res);
      if (err) throw err;
      if (!res.data) throw new Error("Empty SQL stats");
      return res.data;
    },
  });
}
