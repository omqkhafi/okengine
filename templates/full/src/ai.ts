import { ai } from "okengine";
import { z } from "zod";

/** Mock model — `oke.config` pins `ai.dev` to the `mock` driver. */
export const mock = ai.model("mock", { provider: "mock" });

/**
 * Trivial prompt — trigger from the Console Flows panel (`main.echo`) or
 * `POST /echo`. Produces a real Runs / Traces / AI entry.
 */
export const echo = mock.prompt("echo", {
  in: z.object({ text: z.string() }),
  out: z.object({ ok: z.boolean(), echo: z.string() }),
  version: 1,
});
