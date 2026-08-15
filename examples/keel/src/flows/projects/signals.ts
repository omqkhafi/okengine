import { signal } from "okengine";
import { z } from "zod";

/** Project health or archive changed. */
export const projectUpdated = signal("project-updated", {
  delivery: "broadcast",
  retries: 3,
  deadLetter: true,
  schema: z.object({
    projectId: z.string(),
    name: z.string(),
    health: z.string().optional(),
  }),
});
