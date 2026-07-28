import { vault } from "okengine";
import { z } from "zod";

/**
 * Secret contract with a `dev:` fallback — Vault's panel shows fingerprint +
 * resolution chain on first boot. Replace the name / schema for production.
 */
export const appSecret = vault.secret("APP_SECRET", {
  schema: z.string().min(1),
  description: "Application secret",
  dev: "dev-only-secret",
});
