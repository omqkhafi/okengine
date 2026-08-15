import { signal } from "okengine";
import { z } from "zod";

const CommentRef = z.object({
  id: z.string(),
  taskId: z.string(),
  body: z.string(),
});

/** Comment added — mention job (exactly one worker). */
export const commentAdded = signal("comment-added", {
  delivery: "once",
  retries: 3,
  deadLetter: true,
  schema: CommentRef,
});

/** Comment changed — fan-out (search + future subscribers). */
export const commentChanged = signal("comment-changed", {
  delivery: "broadcast",
  retries: 3,
  deadLetter: true,
  schema: CommentRef,
});

/** Comment thread — live feed a late subscriber can replay. */
export const commentThread = signal("comment-thread", {
  delivery: "live",
  optional: true,
  schema: CommentRef,
});
