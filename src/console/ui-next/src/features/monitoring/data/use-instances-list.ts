/**
 * React Query wrapper for `GET /console/instances`.
 */

import { useQuery } from "@tanstack/react-query";
import { instancesList } from "@/client.ts";

/** React Query key for the fleet list. */
export const INSTANCES_LIST_QUERY_KEY = ["console.instances.list"] as const;

/**
 * Fetch the host fleet registry (alive count + lease snapshot).
 *
 * Polls so SIGKILL drop becomes visible after TTL without a dedicated page.
 */
export function useInstancesList() {
  return useQuery({
    queryKey: INSTANCES_LIST_QUERY_KEY,
    queryFn: async () => {
      const res = await instancesList();
      if (res.error) throw new Error(res.error.code);
      if (!res.data) throw new Error("Empty instances list");
      return res.data;
    },
    refetchInterval: 15_000,
  });
}
