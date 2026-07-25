/**
 * URL search state for the Architecture panel (console §7 · §9.13).
 *
 * Focus, depth, and layer toggles live in the URL so a pasted link
 * reproduces the exact view.
 */

import { z } from "zod";
import {
  DEFAULT_LAYERS,
  ELEMENT_LAYERS,
  type ElementLayer,
  type FocusDepth,
  type LayerFlags,
} from "./types.ts";

const searchBool = z
  .union([z.boolean(), z.literal("true"), z.literal("false")])
  .transform((v) => v === true || v === "true");

/** Zod schema for Architecture URL search params. */
export const ArchitectureSearchSchema = z.object({
  /** Focus node id (`unit:bookings`, `flow:bookings.create`, `sql:bookings`). */
  focus: z.string().optional(),
  /** Neighbourhood depth when focused. */
  depth: z.union([z.literal(1), z.literal(2), z.literal("1"), z.literal("2")])
    .transform((v) => (Number(v) === 2 ? 2 : 1) as FocusDepth)
    .default(1),
  /** Data (Store) layer. */
  data: searchBool.optional(),
  /** Messaging (Signal) layer. */
  messaging: searchBool.optional(),
  /** Time (Clock) layer. */
  time: searchBool.optional(),
  /** External (Channel/AI) layer. */
  external: searchBool.optional(),
});

/** Parsed Architecture URL search. */
export type ArchitectureSearch = {
  readonly focus?: string;
  readonly depth: FocusDepth;
  readonly data?: boolean;
  readonly messaging?: boolean;
  readonly time?: boolean;
  readonly external?: boolean;
};

/**
 * Parse Architecture panel search params.
 *
 * @param search - Raw router search
 */
export function parseArchitectureSearch(
  search: Record<string, unknown>,
): ArchitectureSearch {
  const parsed = ArchitectureSearchSchema.safeParse(search);
  if (!parsed.success) {
    return { depth: 1 };
  }
  return parsed.data;
}

/**
 * Serialize Architecture search for navigation (omit defaults).
 *
 * @param search - Search state
 */
export function serializeArchitectureSearch(
  search: ArchitectureSearch,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (search.focus) out.focus = search.focus;
  if (search.depth === 2) out.depth = "2";
  for (const layer of ELEMENT_LAYERS) {
    const value = search[layer];
    if (value === false) out[layer] = "false";
  }
  return out;
}

/**
 * Resolve layer flags from URL search (absent → on).
 *
 * @param search - Parsed search
 */
export function layersOf(search: ArchitectureSearch): LayerFlags {
  return {
    data: search.data ?? DEFAULT_LAYERS.data,
    messaging: search.messaging ?? DEFAULT_LAYERS.messaging,
    time: search.time ?? DEFAULT_LAYERS.time,
    external: search.external ?? DEFAULT_LAYERS.external,
  };
}

/**
 * Focus a node (unit / flow / resource).
 *
 * @param search - Current search
 * @param focus - Node id
 */
export function focusNode(
  search: ArchitectureSearch,
  focus: string,
): ArchitectureSearch {
  return { ...search, focus };
}

/**
 * Clear focus — return to unit-cluster overview.
 *
 * @param search - Current search
 */
export function clearFocus(search: ArchitectureSearch): ArchitectureSearch {
  const { focus: _f, ...rest } = search;
  return { ...rest, depth: search.depth };
}

/**
 * Set neighbourhood depth.
 *
 * @param search - Current search
 * @param depth - 1 or 2
 */
export function setDepth(
  search: ArchitectureSearch,
  depth: FocusDepth,
): ArchitectureSearch {
  return { ...search, depth };
}

/**
 * Toggle one element layer in URL state.
 *
 * @param search - Current search
 * @param layer - Layer
 * @param on - Desired visibility
 */
export function setLayerSearch(
  search: ArchitectureSearch,
  layer: ElementLayer,
  on: boolean,
): ArchitectureSearch {
  return { ...search, [layer]: on };
}
