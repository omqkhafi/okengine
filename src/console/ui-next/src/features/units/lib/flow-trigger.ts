/**
 * Trigger-kind resolution for Manifest flows (Units tree + contract header).
 *
 * Reuses the SAME element-glyph vocabulary as the Traces pane
 * ({@link triggerIconSpec}) so one concept keeps one icon across Console —
 * http → Flow glyph, signal → Signal glyph, cron/every → Clock, cdc → Store,
 * call-only → Flow.
 */

import type { Trigger } from "../../../../../../manifest/types.ts";
import { ELEMENT_ICONS, type ElementHugeIcon } from "@/lib/element-icons.ts";

/** Manifest trigger kinds in priority order when several are declared. */
export type FlowTriggerKind = "http" | "signal" | "cron" | "every" | "cdc" | "internal";

/** All trigger kinds in canonical display order (facet chips, legends). */
export const FLOW_TRIGGER_KINDS: readonly FlowTriggerKind[] = [
  "http",
  "signal",
  "cron",
  "every",
  "cdc",
  "internal",
];

/** Static icon + short label per trigger kind (no per-flow detail). */
export const FLOW_TRIGGER_KIND_SPECS: Record<
  FlowTriggerKind,
  { readonly icon: ElementHugeIcon; readonly label: string }
> = {
  http: { icon: ELEMENT_ICONS.flow.icon, label: "HTTP" },
  signal: { icon: ELEMENT_ICONS.signal.icon, label: "Signal" },
  cron: { icon: ELEMENT_ICONS.clock.icon, label: "Cron" },
  every: { icon: ELEMENT_ICONS.clock.icon, label: "Every" },
  cdc: { icon: ELEMENT_ICONS.store.icon, label: "CDC" },
  internal: { icon: ELEMENT_ICONS.flow.icon, label: "Call-only" },
};

/** Visual + accessible descriptor for one trigger kind. */
export type FlowTriggerSpec = {
  readonly kind: FlowTriggerKind;
  readonly icon: ElementHugeIcon;
  /** Short noun ("HTTP", "Signal") for tooltips / a11y. */
  readonly label: string;
  /** Kind detail — cron expression, signal name, cdc table. */
  readonly detail: string | null;
};

/**
 * Resolve the trigger kind for a Manifest flow (priority order).
 *
 * @param trigger - Manifest `flow.trigger` (undefined → call-only internal)
 */
export function flowTriggerKind(trigger: Trigger | undefined): FlowTriggerKind {
  if (trigger?.http) return "http";
  if (trigger?.signal) return "signal";
  if (trigger?.cron) return "cron";
  if (trigger?.every) return "every";
  if (trigger?.cdc) return "cdc";
  return "internal";
}

/**
 * Resolve the trigger kind + icon for a Manifest flow.
 *
 * @param trigger - Manifest `flow.trigger` (undefined → call-only internal)
 */
export function flowTriggerSpec(trigger: Trigger | undefined): FlowTriggerSpec {
  const kind = flowTriggerKind(trigger);
  const base = FLOW_TRIGGER_KIND_SPECS[kind];
  let detail: string | null = null;
  if (kind === "http" && trigger?.http) detail = `${trigger.http.method} ${trigger.http.path}`;
  else if (kind === "signal" && trigger?.signal) detail = trigger.signal;
  else if (kind === "cron" && trigger?.cron) detail = trigger.cron;
  else if (kind === "every" && trigger?.every) detail = trigger.every;
  else if (kind === "cdc" && trigger?.cdc) detail = trigger.cdc.table;
  return { kind, icon: base.icon, label: base.label, detail };
}
