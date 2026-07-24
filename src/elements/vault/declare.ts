/**
 * Vault declaration — secret contracts (never values).
 *
 * Physics: secrets · config · environment.
 */

/** Options for {@link vault} / {@link vault.secret}. */
export interface VaultSecretOptions {
  /** Human description shown in boot-gap listings. */
  readonly description?: string;
  /** Rotation hint (`"90d"`, …). */
  readonly rotate?: string;
  /** Optional schema validator (Standard Schema / zod / …). */
  readonly schema?: unknown;
  /** Dev-only fallback value (never used in prod boot). */
  readonly dev?: string;
}

/** Declared secret contract handle. */
export interface VaultSecretDecl {
  readonly kind: "secret";
  /** Secret name (e.g. `STRIPE_KEY`). */
  readonly name: string;
  readonly description?: string;
  readonly rotate?: string;
  readonly schema?: unknown;
  readonly dev?: string;
}

/**
 * Declare a vault secret contract.
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
    ...(options.description !== undefined
      ? { description: options.description }
      : {}),
    ...(options.rotate !== undefined ? { rotate: options.rotate } : {}),
    ...(options.schema !== undefined ? { schema: options.schema } : {}),
    ...(options.dev !== undefined ? { dev: options.dev } : {}),
  };
}

/**
 * Vault element — `vault("NAME", opts)` · `vault.secret("NAME", opts)`.
 *
 * A declaration is a contract, not a value. Values resolve at boot through
 * the configured driver chain.
 */
export const vault: {
  (name: string, options?: VaultSecretOptions): VaultSecretDecl;
  secret(name: string, options?: VaultSecretOptions): VaultSecretDecl;
} = Object.assign(declareSecret, { secret: declareSecret });
