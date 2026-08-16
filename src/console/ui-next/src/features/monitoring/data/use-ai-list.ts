/**
 * React Query wrapper for `GET /console/ai`.
 */

import { useQuery } from "@tanstack/react-query";
import { aiList } from "@/client.ts";

/** React Query key for the AI list. */
export const AI_LIST_QUERY_KEY = ["console.ai.list"] as const;

/**
 * Fetch AI catalogue + journal metrics.
 *
 * Real host journals are usually empty — callers must render honest empty.
 */
export function useAiList() {
  return useQuery({
    queryKey: AI_LIST_QUERY_KEY,
    queryFn: async () => {
      const res = await aiList();
      if (res.error) throw new Error(res.error.code);
      if (!res.data) throw new Error("Empty AI list");
      return res.data;
    },
  });
}
