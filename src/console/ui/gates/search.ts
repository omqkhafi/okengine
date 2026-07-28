/**
 * URL search state for the Gates panel (console §7 · §9.7).
 */

import { z } from "zod";

const GatesSearchSchema = z.object({
  q: z.string().optional(),
  /** Inquiry direction — principal or flow. */
  from: z.enum(["principal", "flow"]).optional(),
  /** Selected principal id (`role:…` / `key:…` / `user:…`). */
  principal: z.string().optional(),
  /** Selected flow id. */
  flow: z.string().optional(),
  /** Companion selection for the simulator (other direction). */
  as: z.string().optional(),
});

/** Parsed Gates URL search. */
export type GatesSearch = z.infer<typeof GatesSearchSchema>;

/**
 * Parse Gates panel search params.
 *
 * @param search - Raw router search
 */
export function parseGatesSearch(search: Record<string, unknown>): GatesSearch {
  const parsed = GatesSearchSchema.safeParse(search);
  return parsed.success ? parsed.data : {};
}

/**
 * Serialize Gates search for navigation (omit empties).
 *
 * @param search - Search state
 */
export function serializeGatesSearch(search: GatesSearch): Record<string, string> {
  const out: Record<string, string> = {};
  if (search.q) out.q = search.q;
  if (search.from) out.from = search.from;
  if (search.principal) out.principal = search.principal;
  if (search.flow) out.flow = search.flow;
  if (search.as) out.as = search.as;
  return out;
}

/**
 * Encode a principal selection for the URL.
 *
 * @param kind - Principal kind
 * @param id - Principal id
 */
export function encodePrincipal(kind: "role" | "key" | "user", id: string): string {
  return `${kind}:${id}`;
}

/**
 * Decode a principal selection from the URL.
 *
 * @param value - Encoded value
 */
export function decodePrincipal(
  value: string | undefined,
): { kind: "role" | "key" | "user"; id: string } | null {
  if (!value) return null;
  const i = value.indexOf(":");
  if (i === -1) return null;
  const kind = value.slice(0, i);
  const id = value.slice(i + 1);
  if (kind !== "role" && kind !== "key" && kind !== "user") return null;
  if (!id) return null;
  return { kind, id };
}

/**
 * Open a principal in the from-principal direction.
 *
 * @param search - Current search
 * @param kind - Principal kind
 * @param id - Principal id
 */
export function openPrincipal(
  search: GatesSearch,
  kind: "role" | "key" | "user",
  id: string,
): GatesSearch {
  return {
    ...search,
    from: "principal",
    principal: encodePrincipal(kind, id),
    flow: undefined,
  };
}

/**
 * Open a flow in the from-flow direction.
 *
 * @param search - Current search
 * @param flowId - Flow id
 */
export function openFlow(search: GatesSearch, flowId: string): GatesSearch {
  return {
    ...search,
    from: "flow",
    flow: flowId,
    principal: undefined,
  };
}
