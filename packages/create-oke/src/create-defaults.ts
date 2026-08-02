/**
 * User-global create-oke defaults — `~/.oke/create-defaults.json`.
 *
 * Project-local `.oke/` (mode, sqlite, …) stays under the app cwd.
 * This file is the first home-directory preference for the scaffold wizard.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isTemplateId, type TemplateId } from "./templates.ts";

/** Create profile assumption — mirrors `oke dev` local vs docker-ready. */
export type CreateProfile = "local-only" | "docker-ready";

/** Env columns written into `oke.config.ts` driver maps. */
export type EnvDriverPins = {
  readonly local: string;
  readonly docker: string;
  readonly test: string;
  readonly prod: string;
};

/** Optional AI preference saved with create defaults. */
export type CreateAiPref = {
  readonly enabled: boolean;
  /** Menu id: ollama · openai · anthropic · gemini · lmstudio · openrouter · custom · mock */
  readonly provider: string | null;
  /** Protocol driver id written to `drivers.ai`. */
  readonly driver: string | null;
  /** Chat model id (from wizard / `oke ai setup`). */
  readonly chatModel?: string | null;
  /** Vision model id (ollama). */
  readonly visionModel?: string | null;
  /** Embedding model id (ollama). */
  readonly embedModel?: string | null;
  /** Optional OpenAI-compatible base URL. */
  readonly baseUrl?: string | null;
  /** Env var name for the API key (cloud providers). */
  readonly apiKeyEnv?: string | null;
};

/** Full customize answers persisted for "reuse previous settings". */
export type CreateDefaults = {
  readonly version: 1;
  /** Starter that produced these pins — reuse only when it matches. */
  readonly template: TemplateId;
  readonly profile: CreateProfile;
  readonly drivers: {
    readonly store: {
      readonly sql: EnvDriverPins;
      readonly kv: EnvDriverPins;
      readonly files: EnvDriverPins;
      /** `null` = leave index unset (template default). */
      readonly index: EnvDriverPins | null;
    };
    readonly signal: EnvDriverPins;
    readonly clock: EnvDriverPins;
    readonly vault: EnvDriverPins;
    readonly channel: { readonly email: EnvDriverPins };
    /** `null` = leave `drivers.ai` unset. */
    readonly ai: EnvDriverPins | null;
  };
  readonly ai: CreateAiPref;
  readonly updatedAt: string;
};

/** Relative path under the user home directory. */
export const CREATE_DEFAULTS_RELATIVE = ".oke/create-defaults.json";

/**
 * Absolute path to the create-defaults file.
 *
 * @param home - Override home (tests)
 */
export function createDefaultsPath(home: string = homedir()): string {
  return join(home, CREATE_DEFAULTS_RELATIVE);
}

/**
 * Read and validate create-defaults, or `null` when missing/corrupt.
 *
 * @param path - Absolute file path
 */
export function readCreateDefaults(path: string = createDefaultsPath()): CreateDefaults | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parseCreateDefaults(raw);
  } catch {
    return null;
  }
}

/**
 * Persist create-defaults (creates `~/.oke` as needed).
 *
 * @param defaults - Validated payload
 * @param path - Absolute file path
 */
export function writeCreateDefaults(
  defaults: CreateDefaults,
  path: string = createDefaultsPath(),
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(defaults, null, 2)}\n`, "utf8");
}

/**
 * Build a {@link CreateDefaults} document from customize answers.
 *
 * @param answers - Customize payload (without metadata)
 */
export function toCreateDefaults(
  answers: Omit<CreateDefaults, "version" | "updatedAt">,
): CreateDefaults {
  return {
    version: 1,
    ...answers,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Validate a parsed JSON value as {@link CreateDefaults}.
 *
 * @param raw - Unknown JSON
 */
export function parseCreateDefaults(raw: unknown): CreateDefaults | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return null;
  if (o.profile !== "local-only" && o.profile !== "docker-ready") return null;
  // Older files omit template — treat as standard so reuse stays usable.
  const templateRaw = o.template === undefined || o.template === null ? "standard" : o.template;
  if (typeof templateRaw !== "string" || !isTemplateId(templateRaw)) return null;
  const template = templateRaw;
  if (!o.drivers || typeof o.drivers !== "object") return null;
  const drivers = o.drivers as Record<string, unknown>;
  if (!drivers.store || typeof drivers.store !== "object") return null;
  const store = drivers.store as Record<string, unknown>;
  const sql = parsePins(store.sql);
  const kv = parsePins(store.kv);
  const files = parsePins(store.files);
  if (!sql || !kv || !files) return null;
  const index = store.index === null ? null : parsePins(store.index);
  if (store.index !== null && index === null) return null;
  const signal = parsePins(drivers.signal);
  const clock = parsePins(drivers.clock);
  const vault = parsePins(drivers.vault);
  if (!signal || !clock || !vault) return null;
  if (!drivers.channel || typeof drivers.channel !== "object") return null;
  const email = parsePins((drivers.channel as Record<string, unknown>).email);
  if (!email) return null;
  const aiPins = drivers.ai === null || drivers.ai === undefined ? null : parsePins(drivers.ai);
  if (drivers.ai != null && aiPins === null) return null;
  if (!o.ai || typeof o.ai !== "object") return null;
  const ai = o.ai as Record<string, unknown>;
  if (typeof ai.enabled !== "boolean") return null;
  const provider =
    ai.provider === null || ai.provider === undefined
      ? null
      : typeof ai.provider === "string"
        ? ai.provider
        : null;
  if (ai.provider !== null && ai.provider !== undefined && typeof ai.provider !== "string") {
    return null;
  }
  const driver =
    ai.driver === null || ai.driver === undefined
      ? null
      : typeof ai.driver === "string"
        ? ai.driver
        : null;
  if (ai.driver !== null && ai.driver !== undefined && typeof ai.driver !== "string") {
    return null;
  }
  const chatModel = optionalStringOrNull(ai.chatModel);
  const visionModel = optionalStringOrNull(ai.visionModel);
  const embedModel = optionalStringOrNull(ai.embedModel);
  const baseUrl = optionalStringOrNull(ai.baseUrl);
  const apiKeyEnv = optionalStringOrNull(ai.apiKeyEnv);
  if (
    chatModel === false ||
    visionModel === false ||
    embedModel === false ||
    baseUrl === false ||
    apiKeyEnv === false
  ) {
    return null;
  }
  if (typeof o.updatedAt !== "string") return null;
  return {
    version: 1,
    template,
    profile: o.profile,
    drivers: {
      store: { sql, kv, files, index },
      signal,
      clock,
      vault,
      channel: { email },
      ai: aiPins,
    },
    ai: {
      enabled: ai.enabled,
      provider,
      driver,
      ...(chatModel !== undefined ? { chatModel } : {}),
      ...(visionModel !== undefined ? { visionModel } : {}),
      ...(embedModel !== undefined ? { embedModel } : {}),
      ...(baseUrl !== undefined ? { baseUrl } : {}),
      ...(apiKeyEnv !== undefined ? { apiKeyEnv } : {}),
    },
    updatedAt: o.updatedAt,
  };
}

/**
 * Parse optional string|null fields. `false` = invalid type.
 *
 * @param value - Raw JSON value
 */
function optionalStringOrNull(value: unknown): string | null | undefined | false {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") return value;
  return false;
}

/**
 * @param raw - Candidate pins object
 */
function parsePins(raw: unknown): EnvDriverPins | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.local !== "string" ||
    typeof o.docker !== "string" ||
    typeof o.test !== "string" ||
    typeof o.prod !== "string"
  ) {
    return null;
  }
  return { local: o.local, docker: o.docker, test: o.test, prod: o.prod };
}
