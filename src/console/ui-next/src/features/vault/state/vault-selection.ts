/**
 * Vault page URL search — selected contract + write action.
 */

import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

/** Write action opened from the URL. */
export type VaultAction = "set" | "rotate" | "rotate-master";

/** Search params for `/vault`. */
export interface VaultSearch {
  readonly q?: string;
  readonly name?: string;
  readonly action?: VaultAction;
}

/**
 * Validate Vault search params from the router.
 *
 * @param search - Raw search object
 */
export function validateVaultSearch(search: Record<string, unknown>): VaultSearch {
  const q = typeof search.q === "string" && search.q.length > 0 ? search.q : undefined;
  const name = typeof search.name === "string" && search.name.length > 0 ? search.name : undefined;
  const action =
    search.action === "set" || search.action === "rotate" || search.action === "rotate-master"
      ? search.action
      : undefined;
  return {
    ...(q !== undefined ? { q } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(action !== undefined ? { action } : {}),
  };
}

/**
 * Read + write the Vault page selection from the URL.
 */
export function useVaultSelection() {
  const search = useSearch({ strict: false }) as VaultSearch;
  const navigate = useNavigate();

  const query = typeof search.q === "string" ? search.q : "";
  const selectedName = typeof search.name === "string" ? search.name : null;
  const action = search.action ?? null;

  const patch = useCallback(
    (next: Partial<VaultSearch>) => {
      void navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => {
          const merged = validateVaultSearch({ ...prev, ...next });
          return merged;
        },
        replace: true,
      });
    },
    [navigate],
  );

  const setQuery = useCallback(
    (q: string) => {
      patch({ q: q.length > 0 ? q : undefined });
    },
    [patch],
  );

  const setSelectedName = useCallback(
    (name: string | null) => {
      patch({ name: name ?? undefined, action: undefined });
    },
    [patch],
  );

  const setAction = useCallback(
    (next: VaultAction | null) => {
      patch({ action: next ?? undefined });
    },
    [patch],
  );

  return { query, selectedName, action, setQuery, setSelectedName, setAction };
}
