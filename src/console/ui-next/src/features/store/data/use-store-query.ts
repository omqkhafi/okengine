/**
 * React Query wrapper for `QUERY /console/store/query`.
 */

import { useQuery } from "@tanstack/react-query";
import {
  clientErrorText,
  storeQuery,
  type StoreQueryInput,
  type StoreQueryResult,
} from "@/client.ts";

/** React Query key factory for store browse. */
export const STORE_QUERY_KEY = ["console.store.query"] as const;

/**
 * Keep the last page when only search / limit / topK changed.
 * Switching store, child, or tenant drops the placeholder so we never
 * paint another resource's rows.
 *
 * @param previousData - Last successful (or placeholder) page
 * @param previousKey - Prior `queryKey` (`["console.store.query", input]`)
 * @param next - Incoming query body
 */
export function keepStoreQueryPage(
  previousData: StoreQueryResult | undefined,
  previousKey: readonly unknown[] | undefined,
  next: StoreQueryInput | null,
): StoreQueryResult | undefined {
  if (!previousData || !next || !previousKey) return undefined;
  const prev = previousKey[1];
  if (!isStoreQueryInput(prev)) return undefined;
  if (prev.ref !== next.ref) return undefined;
  if ((prev.child ?? "") !== (next.child ?? "")) return undefined;
  if ((prev.tenant ?? "") !== (next.tenant ?? "")) return undefined;
  return previousData;
}

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
    placeholderData: (previousData, previousQuery) =>
      keepStoreQueryPage(previousData, previousQuery?.queryKey, input),
    queryFn: async () => {
      if (!input) throw new Error("Missing store query input");
      const res = await storeQuery(input);
      if (res.error) throw new Error(clientErrorText(res.error));
      if (!res.data) throw new Error("Empty store query");
      return res.data;
    },
  });
}

function isStoreQueryInput(value: unknown): value is StoreQueryInput {
  return (
    typeof value === "object" &&
    value !== null &&
    "ref" in value &&
    typeof (value as { ref: unknown }).ref === "string"
  );
}
