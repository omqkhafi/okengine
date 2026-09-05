/**
 * Notes vault contracts — secrets and cleartext config.
 *
 * Values resolve through the driver chain (built-in store → process.env →
 * `.env.local` → `dev:` / `vault.fromDocker`). Declare every stack / app name
 * here so Console Vault lists it; put values in `.env.local`, `oke vault set`,
 * or leave the local fallback for Docker-first `oke dev`.
 */

import { vault } from "okengine";

// --- Secrets (fingerprinted) -------------------------------------------------

/** HMAC secret for outbound note webhooks (`fx.vault.get` on create). */
export const webhookSecret = vault.secret("APP_WEBHOOK_SECRET", {
  description: "HMAC secret for outbound note webhooks",
  rotate: "never",
  dev: "dev-webhook-secret-change-me",
});

/** Console operator secret. */
export const okeConsoleSecret = vault.secret("OKE_CONSOLE_SECRET", {
  description: "Console operator secret",
  rotate: "90d",
  dev: "oke-dev-notes-console",
});

/** Mailpit SMTP URL. */
export const channelEmailUrl = vault.secret("OKE_CHANNEL_EMAIL_URL", {
  description: "Mailpit SMTP URL",
  rotate: "never",
  dev: vault.fromDocker("channel.email"),
});

/** SMTP alias. */
export const smtpUrl = vault.secret("SMTP_URL", {
  description: "SMTP URL",
  rotate: "never",
  dev: vault.fromDocker("channel.email"),
});

/** Object storage URL. */
export const storeFilesUrl = vault.secret("OKE_STORE_FILES_URL", {
  description: "Object storage URL",
  rotate: "never",
  dev: vault.fromDocker("store.files"),
});

/** Redis URL. */
export const storeKvUrl = vault.secret("OKE_STORE_KV_URL", {
  description: "Redis URL",
  rotate: "never",
  dev: vault.fromDocker("store.kv"),
});

/** Redis alias. */
export const redisUrl = vault.secret("REDIS_URL", {
  description: "Redis URL",
  rotate: "never",
  dev: vault.fromDocker("store.kv"),
});

/** Direct Postgres URL. */
export const storeSqlUrl = vault.secret("OKE_STORE_SQL_URL", {
  description: "Direct Postgres URL",
  rotate: "never",
  dev: vault.fromDocker("store.sql"),
});

/** Postgres URL (compose / PgDog may rewrite this). */
export const databaseUrl = vault.secret("DATABASE_URL", {
  description: "Postgres URL",
  rotate: "never",
  dev: vault.fromDocker("store.sql"),
});

/** Meilisearch master key (when `store.index` is meilisearch). */
export const meiliMasterKey = vault.secret("MEILI_MASTER_KEY", {
  description: "Meilisearch master key",
  rotate: "90d",
  dev: "dev-notes-meili",
});

// --- Config (shown in the clear) ---------------------------------------------

/** App listen origin. */
export const okeAppUrl = vault.config("OKE_APP_URL", {
  description: "App listen origin",
  dev: "http://127.0.0.1:6530",
});

/** Public API origin (Vite web keeps `VITE_API_URL` empty for same-origin proxy). */
export const publicApiUrl = vault.config("PUBLIC_API_URL", {
  description: "Public API origin",
  dev: "http://127.0.0.1:6530",
});

/** Mailpit UI origin. */
export const mailpitUiUrl = vault.config("MAILPIT_UI_URL", {
  description: "Mailpit UI origin",
  dev: "http://127.0.0.1:8025",
});

/** Meilisearch origin. */
export const meiliUrl = vault.config("MEILI_URL", {
  description: "Meilisearch origin",
  dev: "http://127.0.0.1:7700",
});

/** Maintenance flag (`1` / `0`). */
export const maintenanceMode = vault.config("MAINTENANCE_MODE", {
  description: "Maintenance mode flag",
  dev: "0",
});

/**
 * Full contract list for `oke({ secrets })`.
 *
 * `vault.secret` auto-registers; `vault.config` does not — pass this array so
 * configs resolve in boot / Console the same way secrets do.
 */
export const NOTES_VAULT = [
  webhookSecret,
  okeConsoleSecret,
  channelEmailUrl,
  smtpUrl,
  storeFilesUrl,
  storeKvUrl,
  redisUrl,
  storeSqlUrl,
  databaseUrl,
  meiliMasterKey,
  okeAppUrl,
  publicApiUrl,
  mailpitUiUrl,
  meiliUrl,
  maintenanceMode,
] as const;
