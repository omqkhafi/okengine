/**
 * React Query wrapper for `GET /console/clock`.
 */

import { useQuery } from "@tanstack/react-query";
import { clockList } from "@/client.ts";

/** React Query key for the clock list. */
export const CLOCK_LIST_QUERY_KEY = ["console.clock.list"] as const;

/**
 * Fetch cron health (overdue / drift / lease holder).
 *
 * Polls so overdue state stays honest without a Clock page.
 */
export function useClockList() {
  return useQuery({
    queryKey: CLOCK_LIST_QUERY_KEY,
    queryFn: async () => {
      const res = await clockList();
      if (res.error) throw new Error(res.error.code);
      if (!res.data) throw new Error("Empty clock list");
      return res.data;
    },
    refetchInterval: 15_000,
  });
}
