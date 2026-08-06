/**
 * Boot-implemented driver choices offered by the create-oke customize wizard.
 *
 * Never lists ids that fail loud at boot (signal postgres/nats,
 * ai bedrock/vertex). Clock + journal `postgres` are real (SKIP LOCKED
 * CronStore / durable-run journal).
 */

import type { CreateDefaults, CreateProfile, EnvDriverPins } from "./create-defaults.ts";
import type { TemplateId } from "./templates.ts";

/** One selectable driver option. */
export type DriverChoice = {
  readonly value: string;
  readonly label: string;
};

/** Standard template docker/prod pins (unchanged for local-only profile). */
export const TEMPLATE_DOCKER_PROD = {
  sql: "postgres",
  kv: "redis",
  files: "s3",
  signal: "redis",
  clock: "postgres",
  vault: "openbao",
  email: "smtp",
} as const;

/** Standard template local defaults. */
export const TEMPLATE_LOCAL = {
  sql: "sqlite",
  kv: "memory",
  files: "fs",
  signal: "memory",
  clock: "memory",
  vault: "env",
  email: "console",
} as const;

/** Test-column defaults (always applied). */
export const TEMPLATE_TEST = {
  sql: "memory",
  kv: "memory",
  files: "memory",
  signal: "memory",
  clock: "frozen",
  vault: "memory",
  email: "console",
} as const;

export const SQL_CHOICES: readonly DriverChoice[] = [
  { value: "sqlite", label: "sqlite" },
  { value: "postgres", label: "postgres" },
  { value: "libsql", label: "libsql" },
  { value: "pglite", label: "pglite" },
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
  { value: "libsql", label: "libsql" },
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

export const VAULT_CHOICES: readonly DriverChoice[] = [
  { value: "env", label: "env" },
  { value: "openbao", label: "openbao" },
  { value: "managed", label: "managed" },
  { value: "memory", label: "memory" },
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
export const LLAMA_CPP_IMAGE = "ghcr.io/ggml-org/llama.cpp:server-b10290";
/** @see LLAMA_CPP_IMAGE */
export const OLLAMA_IMAGE = "ollama/ollama:0.32.6";
/** @see LLAMA_CPP_IMAGE */
export const VLLM_IMAGE = "vllm/vllm-openai:v0.26.0";
/** @see LLAMA_CPP_IMAGE */
export const SGLANG_IMAGE = "lmsysorg/sglang:v0.5.16-runtime";

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
 * Build env pins for local-only: user local + template docker/prod + test.
 *
 * @param local - Chosen local driver
 * @param dockerProd - Template docker/prod pin for this facet
 * @param test - Test pin
 */
export function pinsLocalOnly(local: string, dockerProd: string, test: string): EnvDriverPins {
  return { local, docker: dockerProd, test, prod: dockerProd };
}

/**
 * Build env pins when the user chose both columns (docker-ready).
 *
 * @param local - Local driver
 * @param docker - Docker driver (also copied to prod)
 * @param test - Test pin
 */
export function pinsDockerReady(local: string, docker: string, test: string): EnvDriverPins {
  return { local, docker, test, prod: docker };
}

/**
 * Default recommended create-defaults (matches template driver maps).
 *
 * @param profile - Profile assumption
 * @param template - Starter id
 */
export function recommendedDefaults(
  profile: CreateProfile = "docker-ready",
  template: TemplateId = "standard",
): CreateDefaults {
  const store = {
    sql: pinsLocalOnly(TEMPLATE_LOCAL.sql, TEMPLATE_DOCKER_PROD.sql, TEMPLATE_TEST.sql),
    kv: pinsLocalOnly(TEMPLATE_LOCAL.kv, TEMPLATE_DOCKER_PROD.kv, TEMPLATE_TEST.kv),
    files: pinsLocalOnly(TEMPLATE_LOCAL.files, TEMPLATE_DOCKER_PROD.files, TEMPLATE_TEST.files),
    index: null as EnvDriverPins | null,
  };
  return {
    version: 1,
    template,
    profile,
    drivers: {
      store,
      signal: pinsLocalOnly(
        TEMPLATE_LOCAL.signal,
        TEMPLATE_DOCKER_PROD.signal,
        TEMPLATE_TEST.signal,
      ),
      clock: pinsLocalOnly(TEMPLATE_LOCAL.clock, TEMPLATE_DOCKER_PROD.clock, TEMPLATE_TEST.clock),
      vault: pinsLocalOnly(TEMPLATE_LOCAL.vault, TEMPLATE_DOCKER_PROD.vault, TEMPLATE_TEST.vault),
      channel: {
        email: pinsLocalOnly(TEMPLATE_LOCAL.email, TEMPLATE_DOCKER_PROD.email, TEMPLATE_TEST.email),
      },
      ai: null,
    },
    ai: { enabled: false, provider: null, driver: null },
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
 * Facets shown for a template (AI is asked after both env passes).
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
  pgdog: "ghcr.io/pgdogdev/pgdog:v0.1.51",
  "store.kv": "redis:8-alpine",
  "store.files": "rustfs/rustfs:1.0.0-beta.11",
  "channel.email": "axllent/mailpit:v1.22.3",
  vault: "openbao/openbao:2.6.1",
  "store.index": "getmeili/meilisearch:v1.37",
  ai: LLAMA_CPP_IMAGE,
};
