import { gate } from "okengine";

/** Default — near-exact, two keys, no boundary bursts. Every HTTP route. */
export const fair = gate.rate({
  strategy: "sliding-window-counter",
  max: 60,
  per: "1m",
  keyBy: "ip",
});

/** Cheap counters — high-volume reads. */
export const cheap = gate.rate({
  strategy: "fixed-window",
  max: 120,
  per: "1m",
  keyBy: "ip",
});

/** Exact event log — sensitive writes. */
export const exact = gate.rate({
  strategy: "sliding-log",
  max: 10,
  per: "1m",
  keyBy: "ip",
});

/** Burst then refill — mutating / costly routes. */
export const burst = gate.rate({
  strategy: "token-bucket",
  max: 20,
  per: "1m",
  keyBy: "ip",
});
