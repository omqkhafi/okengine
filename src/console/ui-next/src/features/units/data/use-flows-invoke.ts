/**
 * React Query wrappers for Units Call API.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  flowsIdentities,
  flowsInvoke,
  type FlowsInvokeInput,
  type FlowsInvokeResult,
} from "@/client.ts";

/** Query key for invoke-as identities. */
export const FLOWS_IDENTITIES_QUERY_KEY = ["console.flows.identities"] as const;

/**
 * Fetch identities for the Call API picker.
 */
export function useFlowsIdentities() {
  return useQuery({
    queryKey: FLOWS_IDENTITIES_QUERY_KEY,
    queryFn: async () => {
      const res = await flowsIdentities();
      if (res.error) throw new Error(res.error.code);
      return res.data?.identities ?? [];
    },
  });
}

/**
 * Mutation for real host invoke-as.
 */
export function useFlowsInvoke() {
  return useMutation({
    mutationFn: async (input: FlowsInvokeInput): Promise<FlowsInvokeResult> => {
      const res = await flowsInvoke(input);
      if (res.error) {
        const err = new Error(res.error.code) as Error & {
          code: string;
          data?: unknown;
        };
        err.code = res.error.code;
        err.data = res.error.data;
        throw err;
      }
      if (!res.data) throw new Error("Empty invoke response");
      return res.data;
    },
  });
}
