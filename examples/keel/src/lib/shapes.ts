import { z } from "zod";

/** Shared not-found payload. */
export const NotFound = z.object({
  id: z.string(),
});

/** Shared ok payload. */
export const Ok = z.object({
  ok: z.literal(true),
});

/** Duplicate / conflict payload. */
export const Duplicate = z.object({
  id: z.string().optional(),
  identifier: z.string().optional(),
});

/** AI / integration unavailable. */
export const Unavailable = z.object({
  message: z.string(),
});

/** Forbidden for the caller's role. */
export const Forbidden = z.object({
  role: z.string().optional(),
});

/** Id-only input (path `:id`). */
export const IdIn = z.object({
  id: z.string().min(1),
});

/** Id-only output. */
export const IdOut = z.object({
  id: z.string(),
});
