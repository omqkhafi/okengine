import { signal } from "okengine";
import { z } from "zod";

const ProjectRef = z.object({
  projectId: z.string(),
  name: z.string(),
  health: z.string().optional(),
  actorEmail: z.string().nullable().optional(),
});

/** Project health or archive — exclusive lead inbox. */
export const projectUpdated = signal.once("project-updated", {
  retries: 3,
  deadLetter: true,
  schema: ProjectRef,
});

/** Project changed — fan-out (reindex tasks in the project). */
export const projectChanged = signal.broadcast("project-changed", {
  retries: 3,
  deadLetter: true,
  schema: ProjectRef,
});

/** Project health — live board a late subscriber can replay. */
export const projectHealth = signal.live("project-health", { optional: true, schema: ProjectRef });
