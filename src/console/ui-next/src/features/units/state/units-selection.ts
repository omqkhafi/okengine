/**
 * Units page URL search — selected flow id.
 */

import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

/** Search params for `/units`. */
export interface UnitsSearch {
  readonly flow?: string;
}

/**
 * Validate Units search params from the router.
 *
 * @param search - Raw search object
 */
export function validateUnitsSearch(search: Record<string, unknown>): UnitsSearch {
  const flow = typeof search.flow === "string" && search.flow.length > 0 ? search.flow : undefined;
  return {
    ...(flow !== undefined ? { flow } : {}),
  };
}

/**
 * Read + write the Units page selection from the URL.
 */
export function useUnitsSelection() {
  const search = useSearch({ strict: false }) as UnitsSearch;
  const navigate = useNavigate();

  const selectedFlowId = typeof search.flow === "string" ? search.flow : null;

  const setSelectedFlow = useCallback(
    (flow: string | null) => {
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          flow: flow ?? undefined,
        }),
        replace: true,
      });
    },
    [navigate],
  );

  return { selectedFlowId, setSelectedFlow };
}
