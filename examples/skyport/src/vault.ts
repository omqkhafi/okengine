import { vault } from "okengine";
import { z } from "zod";

export const dbUrl = vault.secret("DATABASE_URL", {
  schema: z.string().url(),
  dev: vault.fromDocker("store.sql"),
});

export const dbReplica1 = vault.secret("DATABASE_REPLICA_1", {
  schema: z.string().url(),
  dev: "postgres://localhost/oke-replica",
});

export const anthropicKey = vault.secret("ANTHROPIC_KEY", {
  schema: z.string().min(1),
  dev: "sk-ant-test",
});

export const stripeKey = vault.secret("STRIPE_KEY", {
  schema: z.string().startsWith("sk_"),
  description: "Payments gateway key",
  rotate: "90d",
  dev: "sk_test_local",
});
