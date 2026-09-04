import { signal } from "okengine";
import { z } from "zod";

/** Fired after a note is persisted — subscriber sends email. */
export const noteCreated = signal.once("note-created", {
  retries: 3,
  deadLetter: true,
  schema: z.object({
    id: z.string(),
    title: z.string(),
  }),
});
