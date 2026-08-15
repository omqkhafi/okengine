import { gate } from "okengine";

export const member = gate.policy("member", ({ auth }) => !!auth?.verified);

export const canBook = gate.policy("booking:create", ({ auth }) =>
  auth.scopes.has("booking:create"),
);

export const fair = gate.rate({
  strategy: "sliding-window-counter",
  max: 300,
  per: "1m",
  keyBy: "user",
});

export const book = gate.all(member, canBook, fair);
