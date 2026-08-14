/**
 * React Query mutation for `POST /console/store/sql`.
 */

import { useMutation } from "@tanstack/react-query";
import { storeSql, type StoreSqlInput, type StoreSqlResult } from "@/client.ts";

function toError(res: {
  error?: { code: string; message?: string; data?: unknown } | null;
}): Error | null {
  if (!res.error) return null;
  const data = res.error.data;
  const fromData =
    data && typeof data === "object" && "ref" in data && typeof data.ref === "string"
      ? data.ref
      : null;
  const err = new Error(fromData ?? res.error.message ?? res.error.code) as Error & {
    code: string;
    data?: unknown;
  };
  err.code = res.error.code;
  err.data = res.error.data;
  return err;
}

/**
 * Run a raw SQL console statement (read-only unless `allowWrite`).
 */
export function useStoreSql() {
  return useMutation({
    mutationFn: async (input: StoreSqlInput): Promise<StoreSqlResult> => {
      const res = await storeSql(input);
      const err = toError(res);
      if (err) throw err;
      if (!res.data) throw new Error("Empty SQL result");
      return res.data;
    },
  });
}
