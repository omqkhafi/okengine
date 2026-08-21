/**
 * Access page URL search — selected key + sheet action.
 */

import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

/** Sheet opened from the URL. */
export type AccessAction = "create" | "edit" | "revoke" | "rotate";

/** Search params for `/access`. */
export interface AccessSearch {
  readonly q?: string;
  readonly key?: string;
  readonly action?: AccessAction;
}

/**
 * Validate Access search params from the router.
 *
 * @param search - Raw search object
 */
export function validateAccessSearch(search: Record<string, unknown>): AccessSearch {
  const q = typeof search.q === "string" && search.q.length > 0 ? search.q : undefined;
  const key = typeof search.key === "string" && search.key.length > 0 ? search.key : undefined;
  const action =
    search.action === "create" ||
    search.action === "edit" ||
    search.action === "revoke" ||
    search.action === "rotate"
      ? search.action
      : undefined;
  return {
    ...(q !== undefined ? { q } : {}),
    ...(key !== undefined ? { key } : {}),
    ...(action !== undefined ? { action } : {}),
  };
}

/**
 * Read + write the Access page selection from the URL.
 */
export function useAccessSelection(): {
  readonly query: string;
  readonly selectedKey: string | null;
  readonly action: AccessAction | null;
  readonly setQuery: (q: string) => void;
  readonly setSelectedKey: (key: string | null) => void;
  readonly setAction: (action: AccessAction | null) => void;
} {
  const search = useSearch({ strict: false }) as AccessSearch;
  const navigate = useNavigate();

  const query = typeof search.q === "string" ? search.q : "";
  const selectedKey = typeof search.key === "string" ? search.key : null;
  const action = search.action ?? null;

  const patch = useCallback(
    (next: Partial<AccessSearch>) => {
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => validateAccessSearch({ ...prev, ...next }),
        replace: true,
      });
    },
    [navigate],
  );

  return {
    query,
    selectedKey,
    action,
    setQuery: (q) => {
      patch({ q: q.length > 0 ? q : undefined });
    },
    setSelectedKey: (key) => {
      patch({ key: key ?? undefined, action: undefined });
    },
    setAction: (next) => {
      patch({ action: next ?? undefined });
    },
  };
}
