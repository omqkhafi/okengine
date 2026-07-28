/**
 * Typed search params for the Flows causality view (console §7 · §9.1).
 *
 * Every traversal filter lives in the URL so a pasted link reproduces the
 * exact view. The drawer never becomes a page — Back closes it.
 */

import { z } from "zod";

/** What the operator has selected as the traversal focus. */
export type FlowsSelectionKind = "none" | "cause" | "flow" | "effect";

/** Cause kinds shown in the left column. */
export type CauseKind = "http" | "signal" | "cron" | "every" | "cdc" | "caller";

/** Effect resource kinds (right column). */
export type EffectKindKey =
  | "sql"
  | "kv"
  | "files"
  | "index"
  | "signal"
  | "channel"
  | "ai"
  | "secret"
  | "flow";

/** Drawer presentation modes (console §9.2). */
export type DrawerMode = "closed" | "peek" | "workbench";

/** Centre-column density dial (console §7.2). */
export type Density = "compact" | "comfortable";

/** Centre-column grouping facet. */
export type FlowGrouping = "unit" | "alpha";

/** Left-column grouping facet. */
export type CauseGrouping = "kind" | "alpha";

/** Attention-banner filter chips. */
export type AttentionFilter = "erroring" | "cron-overdue" | "dead-letter" | null;

/** Coerce URL search booleans (`true` / `false` strings). */
const searchBool = z
  .union([z.boolean(), z.literal("true"), z.literal("false")])
  .transform((v) => v === true || v === "true");

/** Zod schema for Flows URL search params. */
export const FlowsSearchSchema = z.object({
  /** Selection kind. */
  sel: z.enum(["none", "cause", "flow", "effect"]).default("none"),
  /** Selected cause id (`http:POST:/bookings`, `signal:order-placed`, …). */
  cause: z.string().optional(),
  /** Selected flow id (`bookings.create`). */
  flow: z.string().optional(),
  /** Selected effect ref (`sql:bookings`, `signal:order-placed`, …). */
  effect: z.string().optional(),
  /** Breadcrumb path of effect/cause hops (comma-separated refs). */
  path: z.string().optional(),
  /** Free-text filter (dims, never hides). */
  q: z.string().optional(),
  /** Unit facet filter. */
  unit: z.string().optional(),
  /** Attention strip filter. */
  attention: z
    .enum(["erroring", "cron-overdue", "dead-letter"])
    .nullable()
    .optional()
    .default(null),
  /** Density dial. */
  density: z.enum(["compact", "comfortable"]).default("comfortable"),
  /** Centre grouping. */
  group: z.enum(["unit", "alpha"]).default("unit"),
  /** Left grouping. */
  causeGroup: z.enum(["kind", "alpha"]).default("kind"),
  /** Direct vs transitive call expansion. */
  transitive: searchBool.default(false),
  /** Hide ubiquitous resources (touch count ≥ threshold). */
  hideUbiquitous: searchBool.default(false),
  /** Drawer mode — never a separate route. */
  drawer: z.enum(["closed", "peek", "workbench"]).default("closed"),
  /** Flow opened in the drawer (may differ from centre selection briefly). */
  open: z.string().optional(),
  /** Contract editor mode. */
  editor: z.enum(["form", "json"]).default("form"),
});

/** Parsed, typed Flows search state. */
export type FlowsSearch = z.infer<typeof FlowsSearchSchema>;

/**
 * Parse unknown search params into a typed {@link FlowsSearch}.
 * Invalid values fall back to defaults — never throw from the URL.
 *
 * @param raw - Router search object
 */
export function parseFlowsSearch(raw: unknown): FlowsSearch {
  const result = FlowsSearchSchema.safeParse(raw ?? {});
  if (result.success) return result.data;
  return FlowsSearchSchema.parse({});
}

/**
 * Serialise typed search into a plain object suitable for TanStack Router.
 * Omits defaults so URLs stay short.
 *
 * @param search - Typed search
 */
export function serializeFlowsSearch(search: FlowsSearch): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  if (search.sel !== "none") out.sel = search.sel;
  if (search.cause) out.cause = search.cause;
  if (search.flow) out.flow = search.flow;
  if (search.effect) out.effect = search.effect;
  if (search.path) out.path = search.path;
  if (search.q) out.q = search.q;
  if (search.unit) out.unit = search.unit;
  if (search.attention) out.attention = search.attention;
  if (search.density !== "comfortable") out.density = search.density;
  if (search.group !== "unit") out.group = search.group;
  if (search.causeGroup !== "kind") out.causeGroup = search.causeGroup;
  if (search.transitive) out.transitive = true;
  if (search.hideUbiquitous) out.hideUbiquitous = true;
  if (search.drawer !== "closed") out.drawer = search.drawer;
  if (search.open) out.open = search.open;
  if (search.editor !== "form") out.editor = search.editor;
  return out;
}

/**
 * Parse a breadcrumb path string into ordered refs.
 *
 * @param path - Comma-separated refs
 */
export function parsePath(path: string | undefined): string[] {
  if (!path) return [];
  return path
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Join breadcrumb refs for the URL.
 *
 * @param refs - Ordered hop refs
 */
export function joinPath(refs: readonly string[]): string | undefined {
  if (refs.length === 0) return undefined;
  return refs.join(",");
}

/**
 * Build the next search state when the operator selects a cause.
 *
 * @param prev - Current search
 * @param causeId - Cause id
 */
export function selectCause(prev: FlowsSearch, causeId: string): FlowsSearch {
  return {
    ...prev,
    sel: "cause",
    cause: causeId,
    flow: undefined,
    effect: undefined,
  };
}

/**
 * Build the next search state when the operator selects a flow.
 *
 * @param prev - Current search
 * @param flowId - Flow id
 */
export function selectFlow(prev: FlowsSearch, flowId: string): FlowsSearch {
  return {
    ...prev,
    sel: "flow",
    flow: flowId,
    cause: undefined,
    effect: undefined,
  };
}

/**
 * Build the next search state when the operator selects an effect
 * (re-centres the graph one hop; appends to breadcrumb path).
 *
 * @param prev - Current search
 * @param effectRef - Effect resource ref
 */
export function selectEffect(prev: FlowsSearch, effectRef: string): FlowsSearch {
  const path = parsePath(prev.path);
  const last = path[path.length - 1];
  const nextPath = last === effectRef ? path : [...path, effectRef].slice(-12);
  return {
    ...prev,
    sel: "effect",
    effect: effectRef,
    flow: undefined,
    cause: undefined,
    path: joinPath(nextPath),
  };
}

/**
 * Open the drawer over a flow without leaving the panel route.
 *
 * @param prev - Current search
 * @param flowId - Flow to open
 * @param mode - Peek (default) or workbench
 */
export function openDrawer(
  prev: FlowsSearch,
  flowId: string,
  mode: Exclude<DrawerMode, "closed"> = "peek",
): FlowsSearch {
  return {
    ...prev,
    open: flowId,
    drawer: mode,
    flow: flowId,
    sel: "flow",
  };
}

/**
 * Close the drawer; URL stays on the Flows panel.
 *
 * @param prev - Current search
 */
export function closeDrawer(prev: FlowsSearch): FlowsSearch {
  return {
    ...prev,
    drawer: "closed",
    open: undefined,
  };
}
