/**
 * React Query wrapper for `GET /console/vault`.
 */

import { useQuery } from "@tanstack/react-query";
import { vaultList } from "@/client.ts";

/** React Query key for the vault list. */
export const VAULT_LIST_QUERY_KEY = ["console.vault.list"] as const;

/**
 * Fetch projected Manifest vault contracts + backend status.
 *
 * Polls so rotate-master `rewrapTargetKekVersion` stays honest.
 */
export function useVaultList() {
  return useQuery({
    queryKey: VAULT_LIST_QUERY_KEY,
    queryFn: async () => {
      const res = await vaultList();
      if (res.error) throw new Error(res.error.code);
      if (!res.data) throw new Error("Empty vault list");
      return res.data;
    },
    refetchInterval: 10_000,
  });
}
