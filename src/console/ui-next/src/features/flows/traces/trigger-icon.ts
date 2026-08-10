/**
 * Map WideEvent trigger kinds to element-aligned HugeIcons.
 *
 * Triggers are not elements, but several map cleanly onto the eight-element
 * vocabulary (signal → Signal, cron/every → Clock, http → Flow, cdc → Store).
 */

import type { ElementHugeIcon } from "@/lib/element-icons.ts";
import { ELEMENT_ICONS } from "@/lib/element-icons.ts";

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
  switch (trigger) {
    case "http":
    case "internal":
      return { icon: ELEMENT_ICONS.flow.icon, label: trigger === "http" ? "HTTP" : "Internal" };
    case "signal":
      return { icon: ELEMENT_ICONS.signal.icon, label: "Signal" };
    case "every":
    case "cron":
      return { icon: ELEMENT_ICONS.clock.icon, label: "Clock" };
    case "cdc":
      return { icon: ELEMENT_ICONS.store.icon, label: "CDC" };
    default:
      return { icon: ELEMENT_ICONS.flow.icon, label: trigger || "Trigger" };
  }
}
