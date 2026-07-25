import { gate } from "okengine";

export const member = gate.policy("member", ({ auth }) => !!auth?.verified);

export const fair = gate.rate({
  strategy: "sliding-window-counter",
  max: 300,
  per: "1m",
  keyBy: "user",
});
