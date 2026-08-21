/**
 * React Query wrapper for `GET /console/access`.
 */

import { useQuery } from "@tanstack/react-query";
import { accessList, type AccessListPayload } from "@/client.ts";

/** React Query key for the Access list. */
export const ACCESS_LIST_QUERY_KEY = ["console.access.list"] as const;

/**
 * Fetch Access keys, users, and grantable scopes.
 */
export function useAccessList() {
  return useQuery({
    queryKey: ACCESS_LIST_QUERY_KEY,
    queryFn: async (): Promise<AccessListPayload> => {
      const res = await accessList();
      if (res.error || !res.data) throw new Error(res.error?.message ?? "Empty access list");
      return res.data;
    },
  });
}
