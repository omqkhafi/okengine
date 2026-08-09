/**
 * Protocol-named vault driver contracts.
 *
 * Driver ids: `env` · `vault` · `managed` · `memory`.
 * Never vendor names (`neon`, …) — vendor choice lives in `images`.
 */

/**
 * Protocol ids for vault drivers.
 *
 * `vault` is okengine's own encrypted-at-rest store; `managed` selects a
 * remote provider (official: `aws-secrets-manager`) or a platform-injected bag.
 */
export type VaultDriverId = "env" | "vault" | "managed" | "memory";

/** Options when opening a vault backend. */
export interface VaultOpenOptions {
  /**
   * Pre-opened SQL connection for the built-in `vault` driver (tests / CLI).
   * Wins over {@link url} when set.
   */
  readonly connection?: import("./types.ts").SqlConnection;
  /** Path to a dotenv file (`env` driver). */
  readonly path?: string;
  /** Env prefix filter for the `env` driver (default: none — whole `process.env`). */
  readonly envPrefix?: string;
  /** Injected env map for tests (defaults to `process.env`). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * Backend behind the `managed` driver — official: `aws-secrets-manager`.
   * Omit for platform-injected secrets. Community adapters may accept other ids.
   */
  readonly provider?: string;
  /** Base URL for remote managed providers (community adapters). */
  readonly url?: string;
  /** Token / API key for remote vaults. */
  readonly token?: string;
  /**
   * Mount / project path for remote vaults. Doubles as the secret-name prefix
   * for `aws-secrets-manager` (`oke/prod/` → `oke/prod/STRIPE_KEY`).
   */
  readonly mount?: string;
  /** Cloud region for regional managed providers. */
  readonly region?: string;
  /** Seed map for `memory` / `managed` drivers. */
  readonly secrets?: Readonly<Record<string, string>>;
  /** HTTP fetch override for remote drivers (tests). */
  readonly fetch?: typeof globalThis.fetch;
}

/** Resolved secret bag — names → cleartext values. Never logged. */
export interface VaultBag {
  /** Protocol driver id. */
  readonly driverId: VaultDriverId;
  /**
   * Read a secret by name.
   *
   * @param name - Secret contract name
   */
  get(name: string): string | undefined;
  /** All names present in this bag. */
  names(): readonly string[];
  /**
   * Write / overwrite a secret (mutable bags: `memory` · `managed`).
   * Used for per-subject crypto-shred keys in the runs store.
   *
   * @param name - Secret name
   * @param value - Cleartext
   */
  set?(name: string, value: string): void;
  /**
   * Delete a secret (mutable bags). Erasure deletes the key, not the bytes.
   *
   * @param name - Secret name
   */
  delete?(name: string): boolean;
  /** Close remote clients when applicable. */
  close?(): Promise<void>;
}

/** Vault driver factory. */
export interface VaultDriver {
  /** Protocol id. */
  readonly id: VaultDriverId;
  /**
   * Open a secret bag.
   *
   * @param options - Driver-specific open options
   */
  open(options?: VaultOpenOptions): Promise<VaultBag>;
}
