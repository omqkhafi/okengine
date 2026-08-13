/**
 * React Query wrapper for `QUERY /console/store/query`.
 */

import { useQuery } from "@tanstack/react-query";
import { storeQuery, type StoreQueryInput } from "@/client.ts";

/** React Query key factory for store browse. */
export const STORE_QUERY_KEY = ["console.store.query"] as const;

/**
 * Browse a store child (rows / keys / hits). Disabled when `enabled` is false.
 *
 * @param input - Query body (ref + child + options)
 * @param enabled - Whether to fetch
 */
export function useStoreQuery(input: StoreQueryInput | null, enabled: boolean) {
  return useQuery({
    queryKey: [...STORE_QUERY_KEY, input] as const,
    enabled: enabled && input !== null,
    queryFn: async () => {
      if (!input) throw new Error("Missing store query input");
      const res = await storeQuery(input);
      if (res.error) throw new Error(res.error.code);
      if (!res.data) throw new Error("Empty store query");
      return res.data;
    },
  });
}
