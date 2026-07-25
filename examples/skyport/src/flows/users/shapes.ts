import { z } from "zod";

export const UserProfile = z.object({
  id: z.string(),
  email: z.string().email().optional(),
});
