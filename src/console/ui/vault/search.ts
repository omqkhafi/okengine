/**
 * URL search state for the Vault panel.
 */

import { z } from "zod";

const VaultSearchSchema = z.object({
  q: z.string().optional(),
  name: z.string().optional(),
  /** Active write action in the detail pane. */
  action: z.enum(["set", "rotate"]).optional(),
});

/** Parsed Vault URL search. */
export type VaultSearch = z.infer<typeof VaultSearchSchema>;

/**
 * Parse Vault panel search params.
 *
 * @param search - Raw router search
 */
export function parseVaultSearch(
  search: Record<string, unknown>,
): VaultSearch {
  const parsed = VaultSearchSchema.safeParse(search);
  return parsed.success ? parsed.data : {};
}

/**
 * Serialize Vault search for navigation (omit empties).
 *
 * @param search - Search state
 */
export function serializeVaultSearch(
  search: VaultSearch,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (search.q) out.q = search.q;
  if (search.name) out.name = search.name;
  if (search.action) out.action = search.action;
  return out;
}

/**
 * Open a vault contract in the URL.
 *
 * @param search - Current search
 * @param name - Contract name
 */
export function openVault(search: VaultSearch, name: string): VaultSearch {
  return { ...search, name, action: undefined };
}

/**
 * Close the open vault detail.
 *
 * @param search - Current search
 */
export function closeVault(search: VaultSearch): VaultSearch {
  const { name: _n, action: _a, ...rest } = search;
  return rest;
}
