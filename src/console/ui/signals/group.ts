/**
 * Group signals by delivery physics — one list, not three tabs (console §9.4).
 */

import type {
  SignalDelivery,
  SignalPhysicsGroup,
  SignalRecord,
} from "./types.ts";

const PHYSICS_ORDER: readonly SignalDelivery[] = [
  "once",
  "broadcast",
  "live",
];

const LABELS: Record<SignalDelivery, string> = {
  once: "Once — competing consumers",
  broadcast: "Broadcast — every subscriber",
  live: "Live — client stream",
};

/**
 * Group signals by delivery physics, preserving declaration order within.
 *
 * @param signals - Flat list
 * @param query - Optional free-text filter
 */
export function groupByPhysics(
  signals: readonly SignalRecord[],
  query = "",
): readonly SignalPhysicsGroup[] {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? signals.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.delivery.includes(q) ||
          s.producers.some((p) => p.flowId.toLowerCase().includes(q)) ||
          s.consumers.some((c) => c.flowId.toLowerCase().includes(q)),
      )
    : signals;

  return PHYSICS_ORDER.map((delivery) => ({
    delivery,
    label: LABELS[delivery],
    signals: filtered.filter((s) => s.delivery === delivery),
  })).filter((g) => g.signals.length > 0);
}
