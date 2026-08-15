import { signal } from "okengine";
import { z } from "zod";

/** Compose-draft TTL elapsed. */
export const draftExpired = signal("draft-expired", {
  delivery: "broadcast",
  retries: 3,
  deadLetter: true,
  optional: true,
  schema: z.object({ id: z.string() }),
});
