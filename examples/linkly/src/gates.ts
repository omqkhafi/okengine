import { gate } from "okengine";

export const member = gate.policy("member", ({ auth }) => !!auth?.verified);

export const fair = gate.rate({
  strategy: "sliding-window-counter", // near-exact, two keys, no boundary bursts
  max: 60,
  per: "1m",
  keyBy: "ip",
});
