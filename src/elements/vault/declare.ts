/**
 * Vault declaration — secret and config contracts (never values for secrets).
 *
 * Physics: secrets · config · environment.
 */

import { requiredEnvRegistry, secretRegistry } from "../../kernel/element-registries.ts";

/** Options for {@link vault} / {@link vault.secret} / {@link vault.config}. */
export interface VaultSecretOptions {
  /** Human description shown in boot-gap listings. */
  readonly description?: string;
  /**
   * Rotation cadence (`"90d"`) or `"never"` when the secret must not
   * rotate. Omit is the same as `"never"`.
   */
  readonly rotate?: string;
  /** Optional schema validator (Standard Schema / zod / …). */
  readonly schema?: unknown;
  /** Dev-only fallback value (never used in prod boot). */
  readonly dev?: string;
  /**
   * When `false`, the value is non-sensitive config — Console may show it
   * in the clear. Defaults to `true` for secrets and `false` for config.
   */
  readonly sensitive?: boolean;
}

/** Declared vault contract handle. */
export interface VaultSecretDecl {
  /** `"secret"` is fingerprinted; `"config"` is shown in the clear. */
  readonly kind: "secret" | "config";
  /** Contract name (e.g. `STRIPE_KEY`). */
  readonly name: string;
  readonly description?: string;
  readonly rotate?: string;
  readonly schema?: unknown;
  readonly dev?: string;
  /** Whether cleartext must never leave the runtime (default by kind). */
  readonly sensitive: boolean;
}

/**
 * `vault.secret` (only) pushes into the shared {@link secretRegistry}
 * (`src/kernel/element-registries.ts`) so {@link oke} can auto-populate
 * `secrets` with zero explicit array — mirrors the {@link on} trigger-drain
 * registry (`src/kernel/on.ts`). `vault.config` is intentionally not
 * auto-registered (out of scope).
 */

/**
 * Snapshot of every `vault.secret` declared since the last reset.
 */
export function listSecrets(): readonly VaultSecretDecl[] {
  return secretRegistry.slice();
}

/**
 * Clear the vault-secret registry (tests / fresh app adopt).
 *
 * @internal
 */
export function resetSecrets(): void {
  secretRegistry.length = 0;
}

/**
 * Declare a vault secret contract (fingerprinted — never revealed).
 *
 * @param name - Secret name
 * @param options - Description / rotate / schema / dev fallback
 */
function declareSecret(name: string, options: VaultSecretOptions = {}): VaultSecretDecl {
  if (!name) {
    throw new TypeError("vault.secret: name is required");
  }
  const decl: VaultSecretDecl = {
    kind: "secret",
    name,
    sensitive: options.sensitive ?? true,
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.rotate !== undefined ? { rotate: options.rotate } : {}),
    ...(options.schema !== undefined ? { schema: options.schema } : {}),
    ...(options.dev !== undefined ? { dev: options.dev } : {}),
  };
  secretRegistry.push(decl);
  return decl;
}

/**
 * Declare a non-sensitive config contract (shown in the clear in Console).
 *
 * @param name - Config name
 * @param options - Description / schema / dev fallback
 */
function declareConfig(name: string, options: VaultSecretOptions = {}): VaultSecretDecl {
  if (!name) {
    throw new TypeError("vault.config: name is required");
  }
  return {
    kind: "config",
    name,
    sensitive: options.sensitive ?? false,
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.rotate !== undefined ? { rotate: options.rotate } : {}),
    ...(options.schema !== undefined ? { schema: options.schema } : {}),
    ...(options.dev !== undefined ? { dev: options.dev } : {}),
  };
}

/**
 * Synchronous environment-variable helpers on `vault.env`.
 *
 * Plain process configuration — no boot chain, no driver, no redaction.
 * Reach for {@link vault.secret} when the value is a contract the runtime
 * must resolve, fingerprint, and keep out of logs.
 */
export interface VaultEnvApi {
  /**
   * Raw value, or `undefined` when unset / empty.
   *
   * @param name - Environment variable name
   */
  (name: string): string | undefined;
  /**
   * Value that must exist. Registers `name` so boot reports every missing
   * variable at once alongside secret gaps.
   *
   * @param name - Environment variable name
   * @throws TypeError when the variable is unset or empty
   */
  required(name: string): string;
  /**
   * Integer value.
   *
   * @param name - Environment variable name
   * @param defaultValue - Used when the variable is unset or empty
   * @throws TypeError when missing without a default, or not an integer
   */
  int(name: string, defaultValue?: number): number;
  /**
   * Boolean value (`1`/`true`/`yes`/`on` · `0`/`false`/`no`/`off`).
   *
   * @param name - Environment variable name
   * @param defaultValue - Used when the variable is unset or empty
   * @throws TypeError when missing without a default, or not boolean-shaped
   */
  bool(name: string, defaultValue?: boolean): boolean;
  /**
   * JSON-parsed value, or `undefined` when unset / empty.
   *
   * @param name - Environment variable name
   * @throws TypeError when the value is not valid JSON
   */
  json<T = unknown>(name: string): T | undefined;
}

/**
 * Read one environment variable, treating empty strings as unset.
 *
 * @param name - Environment variable name
 */
export function readEnv(name: string): string | undefined {
  const value =
    (typeof Bun !== "undefined" ? Bun.env[name] : undefined) ?? process.env[name] ?? undefined;
  return value === undefined || value.length === 0 ? undefined : value;
}

/**
 * Snapshot of every name passed to {@link vault.env.required} since the last
 * reset. Boot turns the missing ones into {@link VaultGap}s.
 */
export function listRequiredEnvNames(): readonly string[] {
  return requiredEnvRegistry.slice();
}

/**
 * Clear the required-env registry (tests / fresh app adopt).
 *
 * @internal
 */
export function resetRequiredEnvNames(): void {
  requiredEnvRegistry.length = 0;
}

/**
 * @param name - Environment variable name
 */
function envValue(name: string): string | undefined {
  if (!name) throw new TypeError("vault.env: name is required");
  return readEnv(name);
}

/**
 * @param name - Environment variable name
 */
function envRequired(name: string): string {
  if (!name) throw new TypeError("vault.env.required: name is required");
  if (!requiredEnvRegistry.includes(name)) requiredEnvRegistry.push(name);
  const value = readEnv(name);
  if (value === undefined) {
    throw new TypeError(`vault.env.required: ${name} is not set`);
  }
  return value;
}

/**
 * @param name - Environment variable name
 * @param defaultValue - Used when the variable is unset
 */
function envInt(name: string, defaultValue?: number): number {
  const raw = envValue(name);
  if (raw === undefined) {
    if (defaultValue === undefined) {
      throw new TypeError(`vault.env.int: ${name} is not set and has no default`);
    }
    return defaultValue;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new TypeError(`vault.env.int: ${name} is not an integer`);
  }
  return parsed;
}

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

/**
 * @param name - Environment variable name
 * @param defaultValue - Used when the variable is unset
 */
function envBool(name: string, defaultValue?: boolean): boolean {
  const raw = envValue(name);
  if (raw === undefined) {
    if (defaultValue === undefined) {
      throw new TypeError(`vault.env.bool: ${name} is not set and has no default`);
    }
    return defaultValue;
  }
  const normalized = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  throw new TypeError(`vault.env.bool: ${name} is not a boolean (got "${raw}")`);
}

/**
 * @param name - Environment variable name
 */
function envJson<T = unknown>(name: string): T | undefined {
  const raw = envValue(name);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new TypeError(`vault.env.json: ${name} is not valid JSON`);
  }
}

/** Sync env helpers exposed as {@link vault.env}. */
export const vaultEnvApi: VaultEnvApi = Object.assign(envValue, {
  required: envRequired,
  int: envInt,
  bool: envBool,
  json: envJson,
});

/**
 * Marker prefix for {@link vault.fromDocker} local fallbacks.
 * Resolved from the compose stack env by `oke dev --docker` / vault boot.
 */
export const FROM_DOCKER_PREFIX = "__oke_from_docker__:";

/**
 * Local fallback that reads the URL built by the image recipe for `role`.
 * The kernel never sees the underlying env-var names — only the URL.
 *
 * @param role - Image role (`store.sql`, …)
 */
export function fromDocker(role: string): string {
  if (!role) throw new TypeError("vault.fromDocker: role is required");
  return `${FROM_DOCKER_PREFIX}${role}`;
}

/**
 * Whether a local fallback is a {@link fromDocker} marker.
 *
 * @param value - Candidate
 */
export function isFromDocker(value: string): boolean {
  return value.startsWith(FROM_DOCKER_PREFIX);
}

/**
 * Role encoded in a {@link fromDocker} marker.
 *
 * @param value - Marker from {@link fromDocker}
 */
export function fromDockerRole(value: string): string {
  if (!isFromDocker(value)) {
    throw new TypeError(`vault: not a fromDocker marker: ${value}`);
  }
  return value.slice(FROM_DOCKER_PREFIX.length);
}

/**
 * Vault element — `vault("NAME", opts)` · `vault.secret` · `vault.config`
 * · `vault.env`.
 *
 * A declaration is a contract, not a value. Values resolve at boot through
 * the configured driver chain. `vault.env` is the escape hatch for plain
 * process configuration that needs no contract.
 */
export const vault: {
  (name: string, options?: VaultSecretOptions): VaultSecretDecl;
  secret(name: string, options?: VaultSecretOptions): VaultSecretDecl;
  config(name: string, options?: VaultSecretOptions): VaultSecretDecl;
  fromDocker(role: string): string;
  env: VaultEnvApi;
} = Object.assign(declareSecret, {
  secret: declareSecret,
  config: declareConfig,
  fromDocker,
  env: vaultEnvApi,
});
