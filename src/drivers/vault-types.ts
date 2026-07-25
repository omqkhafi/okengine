/**
 * Protocol-named vault driver contracts.
 *
 * Driver ids: `sops` · `env` · `openbao` · `infisical` · `managed` · `memory`.
 * Never vendor names (`neon`, `infisical-cloud`, …) — vendor choice lives in `images`.
 */

/** Protocol ids for vault drivers. */
export type VaultDriverId =
  | "sops"
  | "env"
  | "openbao"
  | "infisical"
  | "managed"
  | "memory";

/** Options when opening a vault backend. */
export interface VaultOpenOptions {
  /**
   * Path to a SOPS-encrypted file (`sops` driver) or a dotenv file (`env` driver).
   * Prefer JSON / ENV formats produced by `sops -e` for SOPS.
   */
  readonly path?: string;
  /** Inline SOPS ciphertext (tests). */
  readonly ciphertext?: string | Uint8Array;
  /** Age identity (`AGE-SECRET-KEY-…`) for Typage decryption. */
  readonly ageIdentity?: string;
  /** Env prefix filter for the `env` driver (default: none — whole `process.env`). */
  readonly envPrefix?: string;
  /** Injected env map for tests (defaults to `process.env`). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** OpenBao / Infisical / managed base URL. */
  readonly url?: string;
  /** Token / API key for remote vaults. */
  readonly token?: string;
  /** Mount / project path for remote vaults. */
  readonly mount?: string;
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
