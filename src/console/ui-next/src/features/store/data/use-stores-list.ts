/**
 * React Query wrapper for `GET /console/store`.
 */

import { useQuery } from "@tanstack/react-query";
import { storeList } from "@/client.ts";

/** React Query key for the store list. */
export const STORES_LIST_QUERY_KEY = ["console.store.list"] as const;

/**
 * Fetch projected Manifest stores for the Store explorer.
 */
export function useStoresList() {
  return useQuery({
    queryKey: STORES_LIST_QUERY_KEY,
    queryFn: async () => {
      const res = await storeList();
      if (res.error) throw new Error(res.error.code);
      if (!res.data) throw new Error("Empty store list");
      return res.data;
    },
  });
}
