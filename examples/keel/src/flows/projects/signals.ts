import { signal } from "okengine";
import { z } from "zod";

const ProjectRef = z.object({
  projectId: z.string(),
  name: z.string(),
  health: z.string().optional(),
  actorEmail: z.string().nullable().optional(),
});

/** Project health or archive — exclusive lead inbox. */
export const projectUpdated = signal("project-updated", {
  delivery: "once",
  retries: 3,
  deadLetter: true,
  schema: ProjectRef,
});

/** Project changed — fan-out (reindex tasks in the project). */
export const projectChanged = signal("project-changed", {
  delivery: "broadcast",
  retries: 3,
  deadLetter: true,
  schema: ProjectRef,
});

/** Project health — live board a late subscriber can replay. */
export const projectHealth = signal("project-health", {
  delivery: "live",
  optional: true,
  schema: ProjectRef,
});
