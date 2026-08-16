/**
 * React Query wrapper for `QUERY /console/store/sql/locks`.
 */

import { useQuery } from "@tanstack/react-query";
import { storeSqlLocks, type StoreSqlLocksInput, type StoreSqlLocksResult } from "@/client.ts";

/** React Query key for lock blocking. */
export const STORE_SQL_LOCKS_KEY = ["console.store.sql.locks"] as const;

/** Infra-list poll band — matches server `STORE_SQL_LOCKS_POLL_MS`. */
export const STORE_SQL_LOCKS_POLL_MS = 10_000;

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
 * Poll lock blocking for a SQL store.
 *
 * @param input - Store ref + reveal (disabled when null)
 */
export function useStoreSqlLocks(input: StoreSqlLocksInput | null) {
  return useQuery({
    queryKey: [...STORE_SQL_LOCKS_KEY, input],
    enabled: input !== null,
    refetchInterval: STORE_SQL_LOCKS_POLL_MS,
    queryFn: async (): Promise<StoreSqlLocksResult> => {
      if (!input) throw new Error("Missing store ref");
      const res = await storeSqlLocks(input);
      const err = toError(res);
      if (err) throw err;
      if (!res.data) throw new Error("Empty SQL locks");
      return res.data;
    },
  });
}
