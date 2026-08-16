/**
 * Store page URL search — selected resource effectRef + optional tenant.
 */

import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

/** Facets that expose a query console. */
export type StoreQueryFacet = "sql" | "kv";

/** Right-pane views on `/store` besides resource browse. */
export type StoreView = "query" | "schema" | "performance";

/** Search params for `/store`. */
export interface StoreSearch {
  readonly resource?: string;
  readonly tenant?: string;
  /** `query` = SQL / KV console; `schema` = ER; `performance` = engine stats. */
  readonly view?: StoreView;
  readonly facet?: StoreQueryFacet;
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
  const view =
    search.view === "query" || search.view === "schema" || search.view === "performance"
      ? search.view
      : undefined;
  const facet = search.facet === "sql" || search.facet === "kv" ? search.facet : undefined;
  return {
    ...(resource !== undefined ? { resource } : {}),
    ...(tenant !== undefined ? { tenant } : {}),
    ...(view !== undefined ? { view } : {}),
    ...(facet !== undefined ? { facet } : {}),
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
  const queryFacet: StoreQueryFacet | null =
    search.view === "query" && (search.facet === "sql" || search.facet === "kv")
      ? search.facet
      : null;
  const schemaView = search.view === "schema";
  const performanceView = search.view === "performance";
  const performanceFacet: StoreQueryFacet | null = performanceView
    ? search.facet === "kv"
      ? "kv"
      : "sql"
    : null;

  const setSelectedResource = useCallback(
    (resource: string | null, options?: { readonly keepView?: boolean }) => {
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          resource: resource ?? undefined,
          ...(options?.keepView ? {} : { view: undefined, facet: undefined }),
        }),
        replace: true,
      });
    },
    [navigate],
  );

  const setQueryFacet = useCallback(
    (next: StoreQueryFacet | null) => {
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          view: next ? ("query" as const) : undefined,
          facet: next ?? undefined,
        }),
        replace: true,
      });
    },
    [navigate],
  );

  const setSchemaView = useCallback(
    (open: boolean) => {
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          view: open ? ("schema" as const) : undefined,
          facet: undefined,
        }),
        replace: true,
      });
    },
    [navigate],
  );

  const setPerformanceView = useCallback(
    (open: boolean, facet?: StoreQueryFacet) => {
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          view: open ? ("performance" as const) : undefined,
          facet: open && facet === "kv" ? ("kv" as const) : undefined,
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
    queryFacet,
    schemaView,
    performanceView,
    performanceFacet,
    setSelectedResource,
    setSelectedTenant,
    setQueryFacet,
    setSchemaView,
    setPerformanceView,
  };
}
