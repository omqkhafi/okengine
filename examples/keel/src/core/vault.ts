/**
 * Keel vault contracts — secrets and configs.
 */

import { vault } from "okengine";

/** GitHub PR / issue intake token (stub ingest — never called outbound). */
export const githubToken = vault.secret("GITHUB_TOKEN", {
  description: "GitHub PR intake token",
  rotate: "90d",
  dev: "ghp_dev_keel_github_sync",
});

/** Task suggest / planner model key. */
export const openaiKey = vault.secret("OPENAI_KEY", {
  description: "Task planner model key",
  rotate: "90d",
  dev: "sk-dev-keel-planner",
});

/** Goal digest incoming webhook. */
export const slackWebhook = vault.secret("SLACK_WEBHOOK", {
  description: "Goal digest incoming webhook",
  rotate: "90d",
  dev: "https://hooks.slack.test/keel/goal-digest",
});

/** Slack form-intake bot token (stub ingest). */
export const slackBot = vault.secret("SLACK_BOT", {
  description: "Slack form-intake bot token",
  rotate: "90d",
  dev: "xoxb-dev-keel-intake",
});

/** Outbound webhook HMAC signing key. */
export const webhookSecret = vault.secret("WEBHOOK_SECRET", {
  description: "Outbound webhook HMAC signing key",
  rotate: "never",
  dev: "whsec_dev_keel_outbound",
});

/** Public Keel origin. */
export const publicAppUrl = vault.config("PUBLIC_APP_URL", {
  description: "Public Keel origin",
  dev: "http://127.0.0.1:6530",
});

/** Public API origin. */
export const publicApiUrl = vault.config("PUBLIC_API_URL", {
  description: "Public API origin",
  dev: "http://127.0.0.1:6530/api",
});

/** Public docs origin. */
export const publicDocsUrl = vault.config("PUBLIC_DOCS_URL", {
  description: "Public docs origin",
  dev: "http://127.0.0.1:3000/docs",
});

/** Workspace slug. */
export const keelWorkspace = vault.config("KEEL_WORKSPACE", {
  description: "Workspace slug",
  dev: "keel",
});

/** Console operator secret. */
export const okeConsoleSecret = vault.secret("OKE_CONSOLE_SECRET", {
  description: "Console operator secret",
  rotate: "90d",
  dev: "oke-dev-keel-console",
});

/** App listen origin. */
export const okeAppUrl = vault.config("OKE_APP_URL", {
  description: "App listen origin",
  dev: "http://127.0.0.1:6530",
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

/** Mailpit UI origin. */
export const mailpitUiUrl = vault.config("MAILPIT_UI_URL", {
  description: "Mailpit UI origin",
  dev: "http://127.0.0.1:8025",
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

/** Postgres via PgDog. */
export const databaseUrl = vault.secret("DATABASE_URL", {
  description: "Postgres via PgDog",
  rotate: "never",
  dev: vault.fromDocker("store.sql"),
});

/** PgDog pooler URL. */
export const pgdogUrl = vault.secret("OKE_PGDOG_URL", {
  description: "PgDog pooler URL",
  rotate: "never",
  dev: vault.fromDocker("store.sql"),
});

/** Meilisearch origin. */
export const meiliUrl = vault.config("MEILI_URL", {
  description: "Meilisearch origin",
  dev: "http://127.0.0.1:7700",
});

/** Meilisearch master key. */
export const meiliMasterKey = vault.secret("MEILI_MASTER_KEY", {
  description: "Meilisearch master key",
  rotate: "90d",
  dev: "dev-keel-meili",
});

/** AI driver id. */
export const okeAiDriver = vault.config("OKE_AI_DRIVER", {
  description: "AI driver id",
  dev: "openai-compatible",
});

/** llama.cpp origin (Compose mints the published `:23xxx` port). */
export const okeAiUrl = vault.config("OKE_AI_URL", {
  description: "llama.cpp origin",
});

/** Local chat model. */
export const okeAiModel = vault.config("OKE_AI_MODEL", {
  description: "Local chat model",
  dev: "granite3.3:2b",
});

/** OpenAI-compatible driver key (not OPENAI_KEY). */
export const openaiApiKey = vault.secret("OPENAI_API_KEY", {
  description: "OpenAI-compatible driver key",
  rotate: "90d",
  dev: "sk-dev-keel-openai-compatible",
});

/** Vault contracts — auto-register; seed reads this list. */
export const KEEL_VAULT = [
  githubToken,
  openaiKey,
  slackWebhook,
  slackBot,
  webhookSecret,
  publicAppUrl,
  publicApiUrl,
  publicDocsUrl,
  keelWorkspace,
  okeConsoleSecret,
  okeAppUrl,
  channelEmailUrl,
  smtpUrl,
  mailpitUiUrl,
  storeFilesUrl,
  storeKvUrl,
  redisUrl,
  storeSqlUrl,
  databaseUrl,
  pgdogUrl,
  meiliUrl,
  meiliMasterKey,
  okeAiDriver,
  okeAiUrl,
  okeAiModel,
  openaiApiKey,
] as const;
