/**
 * Store page URL search — selected resource effectRef + optional tenant.
 */

import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

/** Search params for `/store`. */
export interface StoreSearch {
  readonly resource?: string;
  readonly tenant?: string;
}

/**
 * Validate Store search params from the router.
 *
 * @param search - Raw search object
 */
export function validateStoreSearch(search: Record<string, unknown>): StoreSearch {
  const resource =
    typeof search.resource === "string" && search.resource.length > 0 ? search.resource : undefined;
  const tenant =
    typeof search.tenant === "string" && search.tenant.length > 0 ? search.tenant : undefined;
  return {
    ...(resource !== undefined ? { resource } : {}),
    ...(tenant !== undefined ? { tenant } : {}),
  };
}

/**
 * Read + write the Store page selection from the URL.
 */
export function useStoreSelection() {
  const search = useSearch({ strict: false }) as StoreSearch;
  const navigate = useNavigate();

  const selectedResource = typeof search.resource === "string" ? search.resource : null;
  const selectedTenant = typeof search.tenant === "string" ? search.tenant : null;

  const setSelectedResource = useCallback(
    (resource: string | null) => {
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          resource: resource ?? undefined,
        }),
        replace: true,
      });
    },
    [navigate],
  );

  const setSelectedTenant = useCallback(
    (tenant: string | null) => {
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          tenant: tenant ?? undefined,
        }),
        replace: true,
      });
    },
    [navigate],
  );

  return {
    selectedResource,
    selectedTenant,
    setSelectedResource,
    setSelectedTenant,
  };
}
