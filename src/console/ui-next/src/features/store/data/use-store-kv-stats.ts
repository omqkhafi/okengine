/**
 * React Query wrapper for `QUERY /console/store/kv/stats`.
 */

import { useQuery } from "@tanstack/react-query";
import { storeKvStats, type StoreKvStatsInput, type StoreKvStatsResult } from "@/client.ts";

/** React Query key for KV stats. */
export const STORE_KV_STATS_KEY = ["console.store.kv.stats"] as const;

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
 * Fetch Redis-wire KV telemetry for a namespace.
 *
 * @param input - Store ref (disabled when null)
 */
export function useStoreKvStats(input: StoreKvStatsInput | null) {
  return useQuery({
    queryKey: [...STORE_KV_STATS_KEY, input],
    enabled: input !== null,
    queryFn: async (): Promise<StoreKvStatsResult> => {
      if (!input) throw new Error("Missing store ref");
      const res = await storeKvStats(input);
      const err = toError(res);
      if (err) throw err;
      if (!res.data) throw new Error("Empty KV stats");
      return res.data;
    },
  });
}
