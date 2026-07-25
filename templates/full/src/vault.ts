import { vault } from "okengine";
import { z } from "zod";

/** Stub secret contract — replace with your secrets. */
export const appSecret = vault.secret("APP_SECRET", {
  schema: z.string().min(1),
  description: "Application secret",
  dev: "dev-only-secret",
});
