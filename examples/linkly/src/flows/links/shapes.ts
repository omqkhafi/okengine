import { z } from "zod";

/** Create-link input. */
export const NewLink = z.object({
  url: z.string().url(),
  code: z.string().min(1).max(32),
});

/** Link code param. */
export const LinkCode = z.object({
  code: z.string(),
});

/** Stored link row. */
export const Link = z.object({
  code: z.string(),
  url: z.string(),
  userId: z.string().nullable().optional(),
  clicks: z.number(),
  createdAt: z.number().optional(),
});

/** Code already taken. */
export const Taken = z.object({});

/** Link missing. */
export const NotFound = z.object({});
