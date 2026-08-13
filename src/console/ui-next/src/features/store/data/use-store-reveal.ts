/**
 * React Query mutation for audited `POST /console/store/reveal`.
 */

import { useMutation } from "@tanstack/react-query";
import { storeReveal, type StoreRevealInput, type StoreRevealResult } from "@/client.ts";

/**
 * Audited PII reveal for one SQL cell.
 */
export function useStoreReveal() {
  return useMutation({
    mutationFn: async (input: StoreRevealInput): Promise<StoreRevealResult> => {
      const res = await storeReveal(input);
      if (res.error) {
        const err = new Error(res.error.code) as Error & {
          code: string;
          data?: unknown;
        };
        err.code = res.error.code;
        err.data = res.error.data;
        throw err;
      }
      if (!res.data) throw new Error("Empty store reveal");
      return res.data;
    },
  });
}
