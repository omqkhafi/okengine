/**
 * Boot-implemented driver choices offered by the create-oke customize wizard.
 *
 * Never lists ids that fail loud at boot (signal postgres/nats,
 * ai bedrock/vertex). Clock + journal `postgres` are real (SKIP LOCKED
 * CronStore / durable-run journal).
 *
 * Docker-first: `dev`/`prod` share compose-backed protocols; `test` uses
 * PGLite for SQL and memory drivers elsewhere. SQLite is not offered.
 */

import type { CreateDefaults, CreateProfile, EnvDriverPins } from "./create-defaults.ts";
import type { TemplateId } from "./templates.ts";

/** One selectable driver option. */
export type DriverChoice = {
  readonly value: string;
  readonly label: string;
};

/** Template `dev`/`prod` pins (Docker Compose runtime). */
export const TEMPLATE_DEV = {
  sql: "postgres",
  kv: "redis",
  files: "s3",
  signal: "redis",
  clock: "postgres",
  /** Built-in encrypted-at-rest store — SQL-backed, so no extra container. */
  vault: "vault",
  email: "smtp",
} as const;

/** Test-column defaults (PGLite for SQL — not a customize choice). */
export const TEMPLATE_TEST = {
  sql: "pglite",
  kv: "memory",
  files: "memory",
  signal: "memory",
  clock: "frozen",
  vault: "memory",
  email: "console",
} as const;

/** @deprecated Use {@link TEMPLATE_DEV}. */
export const TEMPLATE_DOCKER_PROD = TEMPLATE_DEV;

export const SQL_CHOICES: readonly DriverChoice[] = [
  { value: "postgres", label: "postgres" },
  { value: "memory", label: "memory" },
];

export const KV_CHOICES: readonly DriverChoice[] = [
  { value: "memory", label: "memory" },
  { value: "redis", label: "redis" },
];

export const FILES_CHOICES: readonly DriverChoice[] = [
  { value: "fs", label: "fs" },
  { value: "s3", label: "s3" },
  { value: "memory", label: "memory" },
];

export const INDEX_CHOICES: readonly DriverChoice[] = [
  { value: "none", label: "none" },
  { value: "memory", label: "memory" },
  { value: "pgvector", label: "pgvector" },
  { value: "meilisearch", label: "meilisearch" },
];

export const SIGNAL_CHOICES: readonly DriverChoice[] = [
  { value: "memory", label: "memory" },
  { value: "redis", label: "redis" },
];

export const CLOCK_CHOICES: readonly DriverChoice[] = [
  { value: "memory", label: "memory" },
  { value: "file", label: "file" },
  { value: "postgres", label: "postgres" },
  { value: "frozen", label: "frozen" },
];

export const JOURNAL_CHOICES: readonly DriverChoice[] = [
  { value: "memory", label: "memory" },
  { value: "file", label: "file" },
  { value: "postgres", label: "postgres" },
];

/**
 * Vault backends. `vault` is okengine's own encrypted-at-rest store: it lives
 * in the app's Postgres, so it needs no extra container, and it is the only
 * backend with `oke vault init` / `seal` / `audit`. `managed` reads from a
 * provider secret store (AWS, Azure, GCP, Doppler, 1Password).
 */
export const VAULT_CHOICES: readonly DriverChoice[] = [
  { value: "env", label: "env (dotenv layers only)" },
  { value: "vault", label: "vault (built-in, encrypted at rest — recommended)" },
  { value: "managed", label: "managed (KMS / provider secret store)" },
  { value: "memory", label: "memory (test)" },
];

/** Email driver ids for `drivers.channel.email` (SMS/WhatsApp/push are other mediums). */
export const EMAIL_CHOICES: readonly DriverChoice[] = [
  { value: "console", label: "console" },
  { value: "smtp", label: "smtp" },
  { value: "resend", label: "resend" },
  { value: "sndr", label: "sndr" },
  /** Protocol id is `taqnyat-mail`; menu label stays short in the email facet. */
  { value: "taqnyat-mail", label: "taqnyat" },
];

/**
 * Pinned local-inference images — must match `src/docker/recipes/*` pins.
 * Never `latest` (GGUF-parser CVE floors: llama.cpp ≥ b8146, Ollama ≥ 0.17.1).
 */
export const LLAMA_CPP_IMAGE = "ghcr.io/ggml-org/llama.cpp:server-b10450";
/** @see LLAMA_CPP_IMAGE */
export const OLLAMA_IMAGE = "ollama/ollama:0.32.13";
/** @see LLAMA_CPP_IMAGE */
export const VLLM_IMAGE = "vllm/vllm-openai:v0.27.1";
/** @see LLAMA_CPP_IMAGE */
export const SGLANG_IMAGE = "lmsysorg/sglang:v0.5.17-runtime";

/** AI menu providers → protocol driver. */
export const AI_PROVIDERS = [
  { value: "llama-cpp", label: "llama.cpp (Local)", driver: "openai-compatible" },
  { value: "ollama", label: "Ollama (Local)", driver: "ollama" },
  { value: "vllm", label: "vLLM (self-hosted GPU)", driver: "openai-compatible" },
  { value: "sglang", label: "SGLang (self-hosted GPU)", driver: "openai-compatible" },
  { value: "openai", label: "OpenAI", driver: "openai-compatible" },
  { value: "anthropic", label: "Anthropic", driver: "anthropic" },
  { value: "gemini", label: "Gemini", driver: "openai-compatible" },
  { value: "lmstudio", label: "LM Studio", driver: "openai-compatible" },
  { value: "openrouter", label: "OpenRouter", driver: "openai-compatible" },
  { value: "custom", label: "Custom OpenAI Compatible", driver: "openai-compatible" },
  { value: "mock", label: "Mock (dev only)", driver: "mock" },
] as const;

export type AiProviderId = (typeof AI_PROVIDERS)[number]["value"];

/**
 * Build `{ dev, test, prod }` pins (prod mirrors dev).
 *
 * @param dev - Dev (Compose) driver
 * @param test - Test pin
 * @param prod - Prod pin (defaults to `dev`)
 */
export function pinsEnv(dev: string, test: string, prod: string = dev): EnvDriverPins {
  return { dev, test, prod };
}

/**
 * Docker-ready pins — `dev`/`prod` share the chosen driver; `test` is separate.
 *
 * @param dev - Dev/prod driver
 * @param test - Test pin
 */
export function pinsDockerReady(dev: string, test: string): EnvDriverPins {
  return pinsEnv(dev, test, dev);
}

/**
 * Default recommended create-defaults (matches template driver maps).
 *
 * @param profile - Always docker-ready (kept for call-site compat)
 * @param template - Starter id
 */
export function recommendedDefaults(
  profile: CreateProfile = "docker-ready",
  template: TemplateId = "standard",
): CreateDefaults {
  const store = {
    sql: pinsDockerReady(TEMPLATE_DEV.sql, TEMPLATE_TEST.sql),
    kv: pinsDockerReady(TEMPLATE_DEV.kv, TEMPLATE_TEST.kv),
    files: pinsDockerReady(TEMPLATE_DEV.files, TEMPLATE_TEST.files),
    index: null as EnvDriverPins | null,
  };
  return {
    version: 1,
    template,
    profile,
    drivers: {
      store,
      signal: pinsDockerReady(TEMPLATE_DEV.signal, TEMPLATE_TEST.signal),
      clock: pinsDockerReady(TEMPLATE_DEV.clock, TEMPLATE_TEST.clock),
      vault: pinsDockerReady(TEMPLATE_DEV.vault, TEMPLATE_TEST.vault),
      channel: {
        email: pinsDockerReady(TEMPLATE_DEV.email, TEMPLATE_TEST.email),
      },
      ai: null,
    },
    ai: { enabled: false, provider: null, driver: null },
    locales: [],
    pgdog: false,
    proxy: "none",
    updatedAt: new Date().toISOString(),
  };
}

/** Driver facet ids walked during customize (env columns only). */
export type CustomizeFacetId =
  | "sql"
  | "kv"
  | "files"
  | "index"
  | "signal"
  | "clock"
  | "vault"
  | "email";

/**
 * Facets shown for a template (AI is asked after the env pass).
 *
 * @param template - Starter id
 */
export function customizeFacetsFor(template: TemplateId): readonly CustomizeFacetId[] {
  if (template === "standard") return ["sql"];
  return ["sql", "kv", "files", "index", "signal", "clock", "vault", "email"];
}

/**
 * Resolve protocol driver for an AI provider menu id.
 *
 * @param provider - Menu value
 */
export function aiDriverForProvider(provider: string): string {
  const hit = AI_PROVIDERS.find((p) => p.value === provider);
  return hit?.driver ?? "mock";
}

/** Default image pins keyed by role (standard template). */
export const DEFAULT_IMAGES: Readonly<Record<string, string>> = {
  "store.sql": "postgres:18-alpine",
  pgdog: "ghcr.io/pgdogdev/pgdog:v0.1.53",
  "store.kv": "redis:8-alpine",
  "store.files": "rustfs/rustfs:1.0.0-rc.2",
  "channel.email": "axllent/mailpit:v1.30.7",
  "store.index": "getmeili/meilisearch:v1.53",
  ai: LLAMA_CPP_IMAGE,
  proxy: "caddy:2-alpine",
};

/** Default `images.proxy` pins by wizard id (excluding `none`). */
export const PROXY_IMAGES: Readonly<Record<"caddy" | "traefik" | "nginx", string>> = {
  caddy: "caddy:2-alpine",
  traefik: "traefik:v3.7",
  nginx: "nginx:1.31-alpine",
};
