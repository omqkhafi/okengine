/**
 * Map WideEvent trigger kinds to Units/Traces trigger glyphs.
 *
 * Delegates to {@link FLOW_TRIGGER_KIND_SPECS} so Traces and Units share one
 * icon set (HTTP ≠ call-only, cron ≠ every).
 */

import type { ElementHugeIcon } from "@/lib/element-icons.ts";
import {
  FLOW_TRIGGER_KIND_SPECS,
  type FlowTriggerKind,
} from "@/features/units/lib/flow-trigger.ts";

/** Icon + accessible label for a run's trigger kind. */
export type TriggerIconSpec = {
  readonly icon: ElementHugeIcon;
  readonly label: string;
};

/**
 * Resolve the visual for a WideEvent `trigger` string.
 *
 * @param trigger - `http` | `signal` | `every` | `cdc` | `internal` | …
 */
export function triggerIconSpec(trigger: string): TriggerIconSpec {
  const kind = wideEventTriggerKind(trigger);
  const spec = FLOW_TRIGGER_KIND_SPECS[kind];
  return { icon: spec.icon, label: spec.label };
}

/**
 * Map a WideEvent trigger string onto {@link FlowTriggerKind}.
 *
 * @param trigger - Raw trigger field from a run / WideEvent
 */
function wideEventTriggerKind(trigger: string): FlowTriggerKind {
  switch (trigger) {
    case "http":
      return "http";
    case "signal":
      return "signal";
    case "every":
      return "every";
    case "cron":
      return "cron";
    case "cdc":
      return "cdc";
    case "internal":
      return "internal";
    default:
      return "internal";
  }
}
