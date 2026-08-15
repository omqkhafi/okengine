import { signal } from "okengine";
import { z } from "zod";

const CommentRef = z.object({
  id: z.string(),
  issueId: z.string(),
  body: z.string(),
});

/** Comment posted — realtime inbox. */
export const commentAdded = signal("comment-added", {
  delivery: "live",
  retries: 3,
  deadLetter: true,
  schema: CommentRef,
});

/** Thread marked resolved. */
export const commentResolved = signal("comment-resolved", {
  delivery: "once",
  retries: 3,
  deadLetter: true,
  optional: true,
  schema: CommentRef,
});
