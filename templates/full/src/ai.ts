import { ai } from "okengine";
import { z } from "zod";

export const stub = ai.model("stub", { provider: "anthropic", tier: "haiku" });

/** Stub prompt — replace with real versioned prompts. */
export const echo = stub.prompt("echo", {
  in: z.object({ text: z.string() }),
  out: z.object({ text: z.string() }),
  version: 1,
});
