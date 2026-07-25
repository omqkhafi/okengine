import { z } from "zod";

export const NewLink = z.object({
  url: z.string().url(),
  code: z.string().min(1).max(32),
});

export const LinkCode = z.object({
  code: z.string(),
});

export const Link = z.object({
  id: z.string(),
  code: z.string(),
  url: z.string(),
  userId: z.string(),
  clicks: z.number(),
  createdAt: z.number(),
});

export const Taken = z.object({});
export const NotFound = z.object({});
