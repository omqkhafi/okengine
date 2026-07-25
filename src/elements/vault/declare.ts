/**
 * Vault declaration — secret and config contracts (never values for secrets).
 *
 * Physics: secrets · config · environment.
 */

/** Options for {@link vault} / {@link vault.secret} / {@link vault.config}. */
export interface VaultSecretOptions {
  /** Human description shown in boot-gap listings. */
  readonly description?: string;
  /** Rotation hint (`"90d"`, …). */
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
 * Declare a vault secret contract (fingerprinted — never revealed).
 *
 * @param name - Secret name
 * @param options - Description / rotate / schema / dev fallback
 */
function declareSecret(
  name: string,
  options: VaultSecretOptions = {},
): VaultSecretDecl {
  if (!name) {
    throw new TypeError("vault.secret: name is required");
  }
  return {
    kind: "secret",
    name,
    sensitive: options.sensitive ?? true,
    ...(options.description !== undefined
      ? { description: options.description }
      : {}),
    ...(options.rotate !== undefined ? { rotate: options.rotate } : {}),
    ...(options.schema !== undefined ? { schema: options.schema } : {}),
    ...(options.dev !== undefined ? { dev: options.dev } : {}),
  };
}

/**
 * Declare a non-sensitive config contract (shown in the clear in Console).
 *
 * @param name - Config name
 * @param options - Description / schema / dev fallback
 */
function declareConfig(
  name: string,
  options: VaultSecretOptions = {},
): VaultSecretDecl {
  if (!name) {
    throw new TypeError("vault.config: name is required");
  }
  return {
    kind: "config",
    name,
    sensitive: options.sensitive ?? false,
    ...(options.description !== undefined
      ? { description: options.description }
      : {}),
    ...(options.rotate !== undefined ? { rotate: options.rotate } : {}),
    ...(options.schema !== undefined ? { schema: options.schema } : {}),
    ...(options.dev !== undefined ? { dev: options.dev } : {}),
  };
}

/**
 * Marker prefix for {@link vault.fromStack} dev fallbacks.
 * Resolved from `.env.stack` by `oke dev --stack` / vault boot.
 */
export const FROM_STACK_PREFIX = "__oke_from_stack__:";

/**
 * Dev fallback that reads the URL built by the image recipe for `role`.
 * The kernel never sees the underlying env-var names — only the URL.
 *
 * @param role - Image role (`store.sql`, …)
 */
export function fromStack(role: string): string {
  if (!role) throw new TypeError("vault.fromStack: role is required");
  return `${FROM_STACK_PREFIX}${role}`;
}

/**
 * Whether a dev fallback is a {@link fromStack} marker.
 *
 * @param value - Candidate
 */
export function isFromStack(value: string): boolean {
  return value.startsWith(FROM_STACK_PREFIX);
}

/**
 * Role encoded in a {@link fromStack} marker.
 *
 * @param value - Marker from {@link fromStack}
 */
export function fromStackRole(value: string): string {
  if (!isFromStack(value)) {
    throw new TypeError(`vault: not a fromStack marker: ${value}`);
  }
  return value.slice(FROM_STACK_PREFIX.length);
}

/**
 * Vault element — `vault("NAME", opts)` · `vault.secret` · `vault.config`.
 *
 * A declaration is a contract, not a value. Values resolve at boot through
 * the configured driver chain.
 */
export const vault: {
  (name: string, options?: VaultSecretOptions): VaultSecretDecl;
  secret(name: string, options?: VaultSecretOptions): VaultSecretDecl;
  config(name: string, options?: VaultSecretOptions): VaultSecretDecl;
  fromStack(role: string): string;
} = Object.assign(declareSecret, {
  secret: declareSecret,
  config: declareConfig,
  fromStack,
});
