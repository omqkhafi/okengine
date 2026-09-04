import { signal } from "okengine";
import { z } from "zod";

/** Compose draft expired. */
export const draftExpired = signal.once("draft-expired", {
  retries: 1,
  deadLetter: true,
  schema: z.object({ id: z.string() }),
});
