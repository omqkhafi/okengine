/**
 * Gates panel query — `GET /console/gates`.
 */

import { useQuery } from "@tanstack/react-query";
import { gatesList } from "@/client.ts";

/** React Query key for the Gates panel. */
export const GATES_QUERY_KEY = ["console.gates.list"] as const;

/**
 * Fetch the Gates panel (Module:Action, declared gates, Access principals).
 *
 * @param enabled - Whether to fetch
 */
export function useGates(enabled = true) {
  return useQuery({
    queryKey: GATES_QUERY_KEY,
    enabled,
    queryFn: async () => {
      const res = await gatesList();
      if (res.error) throw new Error(res.error.code);
      return res.data ?? null;
    },
  });
}
