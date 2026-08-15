/**
 * Signal delivery physics — once / broadcast / live — for Units chrome.
 *
 * Delivery is mandatory on the Manifest signal, not the flow. The Units
 * tree joins `flow.trigger.signal` → `manifest.signals[name].delivery`.
 */

import { Activity03Icon, Share08Icon, Target01Icon } from "@hugeicons/core-free-icons";
import type { SignalDelivery } from "../../../../../../manifest/types.ts";
import type { ElementHugeIcon } from "@/lib/element-icons.ts";

/** The three delivery physics, in docs order. */
export const SIGNAL_DELIVERIES: readonly SignalDelivery[] = ["once", "broadcast", "live"];

/** Visual + accessible descriptor for one delivery mode. */
export type SignalDeliverySpec = {
  readonly delivery: SignalDelivery;
  readonly icon: ElementHugeIcon;
  /** Short noun shown on badges and facet chips. */
  readonly label: string;
  /** One-line physics claim for tooltips. */
  readonly title: string;
  /** Border / fill / text classes for a size-5 icon well. */
  readonly wellClass: string;
  /** Outline badge classes (HTTP-method sibling). */
  readonly badgeClass: string;
};

/** Static icon + label + tint per delivery mode. */
export const SIGNAL_DELIVERY_SPECS: Record<SignalDelivery, SignalDeliverySpec> = {
  once: {
    delivery: "once",
    icon: Target01Icon,
    label: "once",
    title: "once — one consumer claims; retries + DLQ",
    wellClass: "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    badgeClass: "border-amber-500/35 bg-amber-500/15 text-amber-800 dark:text-amber-400",
  },
  broadcast: {
    delivery: "broadcast",
    icon: Share08Icon,
    label: "broadcast",
    title: "broadcast — every subscriber gets a copy",
    wellClass: "border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-400",
    badgeClass: "border-sky-500/35 bg-sky-500/15 text-sky-700 dark:text-sky-400",
  },
  live: {
    delivery: "live",
    icon: Activity03Icon,
    label: "live",
    title: "live — retained feed; late subscribers replay history",
    wellClass: "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    badgeClass: "border-emerald-500/35 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
};

/**
 * Resolve a delivery spec, or `null` when the name is unknown.
 *
 * @param delivery - Manifest `signal.delivery`
 */
export function signalDeliverySpec(
  delivery: SignalDelivery | null | undefined,
): SignalDeliverySpec | null {
  if (!delivery) return null;
  return SIGNAL_DELIVERY_SPECS[delivery] ?? null;
}
