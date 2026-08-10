/**
 * Manifest query for the Flow graph — `GET /console/manifest`.
 */

import { useQuery } from "@tanstack/react-query";
import { manifestGet } from "@/client.ts";

/** React Query key for the Manifest snapshot. */
export const MANIFEST_QUERY_KEY = ["console.manifest.get"] as const;

/**
 * Fetch the current Manifest snapshot.
 */
export function useManifest() {
  return useQuery({
    queryKey: MANIFEST_QUERY_KEY,
    queryFn: async () => {
      const res = await manifestGet();
      if (res.error) throw new Error(res.error.code);
      return res.data?.manifest ?? null;
    },
  });
}
