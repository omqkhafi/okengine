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

/** Cycle is closed — cannot add or move work into it. */
export const CycleClosed = z.object({
  cycleId: z.string(),
});

/** AI / integration unavailable. */
export const Unavailable = z.object({
  message: z.string(),
});

/** Id-only input (path `:id`). */
export const IdIn = z.object({
  id: z.string().min(1),
});

/** Id-only output. */
export const IdOut = z.object({
  id: z.string(),
});
