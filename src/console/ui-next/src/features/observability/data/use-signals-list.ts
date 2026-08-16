/**
 * React Query wrapper for `GET /console/signals`.
 */

import { useQuery } from "@tanstack/react-query";
import { signalsList } from "@/client.ts";

/** React Query key for the signals list. */
export const SIGNALS_LIST_QUERY_KEY = ["console.signals.list"] as const;

/**
 * Fetch signal queue lag / depth from the Console host bus.
 */
export function useSignalsList() {
  return useQuery({
    queryKey: SIGNALS_LIST_QUERY_KEY,
    queryFn: async () => {
      const res = await signalsList();
      if (res.error) throw new Error(res.error.code);
      if (!res.data) throw new Error("Empty signals list");
      return res.data;
    },
    refetchInterval: 10_000,
  });
}
