/**
 * React Query mutations for Store edit / preview / delete.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  storeDelete,
  storeEdit,
  storePreview,
  type StoreDeleteInput,
  type StoreDeleteResult,
  type StoreEditInput,
  type StoreEditResult,
} from "@/client.ts";
import { STORE_QUERY_KEY } from "./use-store-query.ts";
import { STORES_LIST_QUERY_KEY } from "./use-stores-list.ts";

function toError(res: {
  error?: { code: string; message?: string; data?: unknown } | null;
}): Error | null {
  if (!res.error) return null;
  const err = new Error(res.error.message ?? res.error.code) as Error & {
    code: string;
    data?: unknown;
  };
  err.code = res.error.code;
  err.data = res.error.data;
  return err;
}

/**
 * Direct Store edit (dry-run unless `commit: true`). Invalidates browse on success.
 */
export function useStoreEdit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: StoreEditInput): Promise<StoreEditResult> => {
      const res = await storeEdit(input);
      const err = toError(res);
      if (err) throw err;
      if (!res.data) throw new Error("Empty store edit");
      return res.data;
    },
    onSuccess: async (_data, input) => {
      if (input.commit) {
        await Promise.all([
          qc.invalidateQueries({ queryKey: STORE_QUERY_KEY }),
          qc.invalidateQueries({ queryKey: STORES_LIST_QUERY_KEY }),
        ]);
      }
    },
  });
}

/**
 * Dry-run preview for a Store edit (never mutates).
 */
export function useStorePreview() {
  return useMutation({
    mutationFn: async (
      input: Omit<StoreEditInput, "confirmation" | "reason" | "commit">,
    ): Promise<StoreEditResult> => {
      const res = await storePreview(input);
      const err = toError(res);
      if (err) throw err;
      if (!res.data) throw new Error("Empty store preview");
      return res.data;
    },
  });
}

/**
 * Delete Store rows/keys. Invalidates browse on success.
 */
export function useStoreDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: StoreDeleteInput): Promise<StoreDeleteResult> => {
      const res = await storeDelete(input);
      const err = toError(res);
      if (err) throw err;
      if (!res.data) throw new Error("Empty store delete");
      return res.data;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: STORE_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: STORES_LIST_QUERY_KEY }),
      ]);
    },
  });
}
