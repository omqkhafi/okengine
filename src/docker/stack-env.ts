/**
 * Role-accurate `.env.docker` entries — not a one-size USER/PASSWORD/DB template.
 */

import { envPrefix } from "./helpers.ts";
import { recipeFor } from "./recipes/index.ts";
import type {
  ImageRecipe,
  ServiceEndpoint,
  ServiceSpec,
} from "./types.ts";

/** Options for {@link buildRoleStackEnv} / {@link buildStackEnvMap}. */
export interface StackEnvBuildOptions {
  /** Hostname in URLs (default `127.0.0.1`). */
  readonly host?: string;
  /**
   * Added to recipe UI host ports (Mailpit 8025, RustFS 9001) when
   * `instanceId` offsets are in use.
   */
  readonly extraPortOffset?: number;
  /** Extra recipes for {@link recipeFor}. */
  readonly recipes?: readonly ImageRecipe[];
}

/**
 * Preferred key order when serialising a role block (unknown keys sort after).
 */
export const ROLE_ENV_KEY_ORDER: Readonly<Record<string, readonly string[]>> = {
  "store.sql": [
    "OKE_STORE_SQL_USER",
    "OKE_STORE_SQL_PASSWORD",
    "OKE_STORE_SQL_DB",
    "OKE_STORE_SQL_URL",
    "DATABASE_URL",
  ],
  "store.kv": [
    "OKE_STORE_KV_PASSWORD",
    "OKE_STORE_KV_URL",
    "REDIS_URL",
  ],
  "store.files": [
    "OKE_STORE_FILES_ACCESS_KEY",
    "OKE_STORE_FILES_SECRET_KEY",
    "OKE_STORE_FILES_BUCKET",
    "OKE_STORE_FILES_URL",
    "OKE_STORE_FILES_UI_URL",
    "S3_ENDPOINT",
    "S3_BUCKET",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
  ],
  "channel.email": [
    "OKE_CHANNEL_EMAIL_URL",
    "SMTP_URL",
    "OKE_CHANNEL_EMAIL_UI_URL",
  ],
};

/** Friendly section titles for known compose roles. */
export const ROLE_SECTION_TITLE: Readonly<Record<string, string>> = {
  "store.sql": "store.sql — Postgres",
  "store.kv": "store.kv — Redis",
  "store.files": "store.files — S3 (access key · secret · bucket)",
  "store.index": "store.index — search index",
  "channel.email": "channel.email — SMTP (Mailpit)",
  signal: "signal — message bus",
};

/**
 * Build `.env.docker` key/value map for one service (recipe-accurate fields).
 *
 * @param spec - Normalised service
 * @param recipe - Matched recipe
 * @param endpoint - Host / port / credentials
 * @param extraPortOffset - UI port offset
 */
export function buildRoleStackEnv(
  spec: ServiceSpec,
  recipe: ImageRecipe,
  endpoint: ServiceEndpoint,
  extraPortOffset = 0,
): Record<string, string> {
  const p = envPrefix(spec.role);
  const url = recipe.url(spec, endpoint);

  switch (recipe.id) {
    case "postgres":
      return {
        [`${p}_USER`]: endpoint.user,
        [`${p}_PASSWORD`]: endpoint.password,
        [`${p}_DB`]: endpoint.database,
        [`${p}_URL`]: url,
        DATABASE_URL: url,
      };
    case "redis":
      return {
        [`${p}_PASSWORD`]: endpoint.password,
        [`${p}_URL`]: url,
        REDIS_URL: url,
      };
    case "rustfs": {
      const api = `http://${endpoint.host}:${endpoint.port}`;
      const uiPort = 9001 + extraPortOffset;
      return {
        [`${p}_ACCESS_KEY`]: endpoint.user,
        [`${p}_SECRET_KEY`]: endpoint.password,
        [`${p}_BUCKET`]: endpoint.database,
        [`${p}_URL`]: url,
        [`${p}_UI_URL`]: `http://${endpoint.host}:${uiPort}`,
        S3_ENDPOINT: api,
        S3_BUCKET: endpoint.database,
        AWS_ACCESS_KEY_ID: endpoint.user,
        AWS_SECRET_ACCESS_KEY: endpoint.password,
      };
    }
    case "mailpit": {
      const uiPort = 8025 + extraPortOffset;
      return {
        [`${p}_URL`]: url,
        SMTP_URL: url,
        [`${p}_UI_URL`]: `http://${endpoint.host}:${uiPort}`,
      };
    }
    default:
      return {
        [`${p}_USER`]: endpoint.user,
        [`${p}_PASSWORD`]: endpoint.password,
        [`${p}_DB`]: endpoint.database,
        [`${p}_URL`]: url,
      };
  }
}

/**
 * Build the full stack env map for all specs.
 *
 * @param specs - Services
 * @param options - Host / offset / recipes
 */
export function buildStackEnvMap(
  specs: readonly ServiceSpec[],
  options: StackEnvBuildOptions = {},
): Record<string, string> {
  const host = options.host ?? "127.0.0.1";
  const offset = options.extraPortOffset ?? 0;
  const recipes = options.recipes ?? [];
  const env: Record<string, string> = {};
  for (const spec of specs) {
    const recipe = recipeFor(spec.image, recipes);
    const endpoint: ServiceEndpoint = {
      host,
      port: spec.hostPort,
      user: spec.credentials.user,
      password: spec.credentials.password,
      database: spec.credentials.database,
    };
    Object.assign(env, buildRoleStackEnv(spec, recipe, endpoint, offset));
  }
  return env;
}

/**
 * Infer role from an `OKE_<ROLE>_*` key.
 *
 * @param key - Env key
 */
export function roleFromEnvKey(key: string): string | undefined {
  if (!key.startsWith("OKE_")) return undefined;
  const rest = key.slice("OKE_".length);
  const knownSuffixes = [
    "_ACCESS_KEY",
    "_SECRET_KEY",
    "_BUCKET",
    "_UI_URL",
    "_PASSWORD",
    "_USER",
    "_DB",
    "_URL",
    "_HOST",
    "_PORT",
  ] as const;
  for (const suffix of knownSuffixes) {
    if (rest.endsWith(suffix)) {
      return rest.slice(0, -suffix.length).toLowerCase().replaceAll("_", ".");
    }
  }
  return undefined;
}

/**
 * Alias keys that belong to a role block (non-`OKE_*` names).
 */
export const ROLE_ALIAS_KEYS: Readonly<Record<string, readonly string[]>> = {
  "store.sql": ["DATABASE_URL"],
  "store.kv": ["REDIS_URL"],
  "store.files": [
    "S3_ENDPOINT",
    "S3_BUCKET",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
  ],
  "channel.email": ["SMTP_URL"],
};

/**
 * Escape a dotenv value when it contains spaces or `#`.
 *
 * @param value - Raw value
 */
export function escapeEnv(value: string): string {
  if (/[\s#"'$\\]/.test(value)) {
    return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  }
  return value;
}
