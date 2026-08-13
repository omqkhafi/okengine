/**
 * Trigger-kind resolution for Manifest flows (Units tree + contract header).
 *
 * Icons stay in the eight-element family used by Traces ({@link triggerIconSpec}),
 * with sibling glyphs where two kinds share an element so the Units tree can
 * tell them apart at a glance: HTTP vs call-only (Flow), cron vs every (Clock).
 */

import {
  ApiIcon,
  Calendar03Icon,
  FunctionCircleIcon,
  Timer01Icon,
} from "@hugeicons/core-free-icons";
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

/** Static icon + label + icon-well tint per trigger kind. */
export const FLOW_TRIGGER_KIND_SPECS: Record<
  FlowTriggerKind,
  {
    readonly icon: ElementHugeIcon;
    readonly label: string;
    /** Border / fill / text classes for a size-5 icon well. */
    readonly wellClass: string;
  }
> = {
  http: {
    icon: ApiIcon,
    label: "HTTP",
    wellClass: "border-sky-500/35 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
  signal: {
    icon: ELEMENT_ICONS.signal.icon,
    label: "Signal",
    wellClass: "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  cron: {
    icon: Calendar03Icon,
    label: "Cron",
    wellClass: "border-violet-500/35 bg-violet-500/10 text-violet-700 dark:text-violet-400",
  },
  every: {
    icon: Timer01Icon,
    label: "Every",
    wellClass: "border-teal-500/35 bg-teal-500/10 text-teal-700 dark:text-teal-400",
  },
  cdc: {
    icon: ELEMENT_ICONS.store.icon,
    label: "CDC",
    wellClass: "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  internal: {
    icon: FunctionCircleIcon,
    label: "Call-only",
    wellClass: "border-zinc-500/35 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  },
};

/** Visual + accessible descriptor for one trigger kind. */
export type FlowTriggerSpec = {
  readonly kind: FlowTriggerKind;
  readonly icon: ElementHugeIcon;
  /** Short noun ("HTTP", "Signal") for tooltips / a11y. */
  readonly label: string;
  /** Kind detail — cron expression, signal name, cdc table. */
  readonly detail: string | null;
  /** Icon-well tint shared with the Units band header. */
  readonly wellClass: string;
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
  return {
    kind,
    icon: base.icon,
    label: base.label,
    detail,
    wellClass: base.wellClass,
  };
}
