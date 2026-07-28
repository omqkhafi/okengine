import { ai, store } from "okengine";
import { z } from "zod";
import { getBooking, refundBooking } from "./flows/bookings";

export const smart = ai.model("smart", { provider: "anthropic", tier: "opus" });
export const fast = ai.model("fast", { provider: "anthropic", tier: "haiku" });

// A prompt is a VERSIONED ARTIFACT with a validated output shape — not a string in a handler
export const triage = smart.prompt("ticket-triage", {
  in: z.object({ subject: z.string(), body: z.string() }),
  out: z.object({ urgency: z.enum(["low", "high"]), team: z.string(), summary: z.string() }),
  version: 3,
  evals: "./evals/triage.jsonl", // regression-gated in CI via `oke eval`
  budget: { maxCostPerCall: 0.02 }, // cost is a first-class dimension
});

export const embed = ai.embed("docs", { model: fast, into: store.index("kb") });

// An agent whose tools are YOUR OWN FLOWS — each carrying its gates and effects
export const support = ai.agent("support", {
  model: smart,
  tools: [getBooking, refundBooking],
  maxSteps: 6,
  budget: { maxCostPerRun: 0.25 },
});
