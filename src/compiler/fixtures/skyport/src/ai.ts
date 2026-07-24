import { ai } from "okengine";
import { getBooking, refundBooking } from "./flows/bookings/index.ts";

export const smart = ai.model("smart", { provider: "anthropic", tier: "opus" });

export const triage = smart.prompt("ticket-triage", {
  version: 3,
  evals: "./evals/triage.jsonl",
  budget: { maxCostPerCall: 0.02 },
});

export const support = ai.agent("support", {
  tools: [getBooking, refundBooking],
  maxSteps: 6,
});
