import { vault } from "okengine";

/** Shared webhook HMAC secret — prove Vault wiring on note create. */
export const webhookSecret = vault.secret("APP_WEBHOOK_SECRET", {
  description: "HMAC secret for outbound note webhooks",
  dev: "dev-webhook-secret-change-me",
});
