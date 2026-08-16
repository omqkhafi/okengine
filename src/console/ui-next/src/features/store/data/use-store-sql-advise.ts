/**
 * React Query mutation for `POST /console/store/sql/advise`.
 */

import { useMutation } from "@tanstack/react-query";
import { storeSqlAdvise, type StoreSqlAdviseInput, type StoreSqlAdviseResult } from "@/client.ts";

function toError(res: {
  error?: { code: string; message?: string; data?: unknown } | null;
}): Error | null {
  if (!res.error) return null;
  const data = res.error.data;
  const reason =
    data && typeof data === "object" && "reason" in data && typeof data.reason === "string"
      ? data.reason
      : null;
  const err = new Error(reason ?? res.error.message ?? res.error.code) as Error & {
    code: string;
    data?: unknown;
  };
  err.code = res.error.code;
  err.data = res.error.data;
  return err;
}

/**
 * Run `index_advisor(query)` for one captured statement.
 */
export function useStoreSqlAdvise() {
  return useMutation({
    mutationFn: async (input: StoreSqlAdviseInput): Promise<StoreSqlAdviseResult> => {
      const res = await storeSqlAdvise(input);
      const err = toError(res);
      if (err) throw err;
      if (!res.data) throw new Error("Empty advise result");
      return res.data;
    },
  });
}
