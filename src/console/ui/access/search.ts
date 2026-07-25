/**
 * URL search state for the Access panel (console §7 · §9.14).
 */

import { z } from "zod";

const AccessSearchSchema = z.object({
  q: z.string().optional(),
  /** Which plane is focused — never merged. */
  plane: z.enum(["operator", "user"]).optional(),
  /** Selected kind within the plane. */
  kind: z.enum(["operator", "user", "role", "key", "invite"]).optional(),
  /** Selected entity id. */
  id: z.string().optional(),
  /** Detail mode. */
  view: z.enum(["detail", "effective", "create-key", "grant-role"]).optional(),
});

/** Parsed Access URL search. */
export type AccessSearch = z.infer<typeof AccessSearchSchema>;

/**
 * Parse Access panel search params.
 *
 * @param search - Raw router search
 */
export function parseAccessSearch(
  search: Record<string, unknown>,
): AccessSearch {
  const parsed = AccessSearchSchema.safeParse(search);
  return parsed.success ? parsed.data : {};
}

/**
 * Serialize Access search for navigation (omit empties).
 *
 * @param search - Search state
 */
export function serializeAccessSearch(
  search: AccessSearch,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (search.q) out.q = search.q;
  if (search.plane) out.plane = search.plane;
  if (search.kind) out.kind = search.kind;
  if (search.id) out.id = search.id;
  if (search.view) out.view = search.view;
  return out;
}

/**
 * Open a principal / key / role in the Access panel.
 *
 * @param search - Current search
 * @param plane - Plane
 * @param kind - Entity kind
 * @param id - Entity id
 */
export function openAccessEntity(
  search: AccessSearch,
  plane: "operator" | "user",
  kind: "operator" | "user" | "role" | "key" | "invite",
  id: string,
): AccessSearch {
  return {
    ...search,
    plane,
    kind,
    id,
    view: "detail",
  };
}
