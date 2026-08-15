import { signal } from "okengine";
import { z } from "zod";

/** Issue SLA high-risk or breached. */
export const slaBreaching = signal("sla-breaching", {
  delivery: "once",
  retries: 3,
  deadLetter: true,
  optional: true,
  schema: z.object({
    id: z.string(),
    identifier: z.string(),
    title: z.string(),
  }),
});
