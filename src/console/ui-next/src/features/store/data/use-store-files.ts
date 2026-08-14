/**
 * React Query wrappers for files object get / put.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  storeEdit,
  storeFileGet,
  type StoreEditResult,
  type StoreFileGetInput,
  type StoreFileObject,
} from "@/client.ts";
import { STORE_QUERY_KEY } from "./use-store-query.ts";
import { STORES_LIST_QUERY_KEY } from "./use-stores-list.ts";

/** React Query key factory for a files object. */
export const STORE_FILE_QUERY_KEY = ["console.store.object"] as const;

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
 * Load one files object for preview / download.
 *
 * @param input - Store ref + key
 * @param enabled - Whether to fetch
 */
export function useStoreFile(input: StoreFileGetInput | null, enabled: boolean) {
  return useQuery({
    queryKey: [...STORE_FILE_QUERY_KEY, input] as const,
    enabled: enabled && input !== null,
    queryFn: async () => {
      if (!input) throw new Error("Missing file get input");
      const res = await storeFileGet(input);
      const err = toError(res);
      if (err) throw err;
      if (!res.data) throw new Error("Empty store object");
      return res.data;
    },
  });
}

/** Put payload for a files object. */
export type StoreFilePutInput = {
  readonly ref: string;
  readonly key: string;
  readonly tenant?: string | null;
  readonly body: string;
  readonly encoding: "utf8" | "base64";
  readonly originalName?: string;
};

/**
 * Upload / overwrite a files object via `POST /console/store/edit`.
 */
export function useStoreFilePut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: StoreFilePutInput): Promise<StoreEditResult> => {
      const res = await storeEdit({
        ref: input.ref,
        key: input.key,
        ...(input.tenant ? { tenant: input.tenant } : {}),
        patch: {
          body: input.body,
          encoding: input.encoding,
          ...(input.originalName ? { originalName: input.originalName } : {}),
        },
        commit: true,
      });
      const err = toError(res);
      if (err) throw err;
      if (!res.data) throw new Error("Empty store file put");
      return res.data;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: STORE_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: STORE_FILE_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: STORES_LIST_QUERY_KEY }),
      ]);
    },
  });
}

export type { StoreFileObject };
