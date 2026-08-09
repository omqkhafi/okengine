/**
 * Vault error taxonomy — one class, one closed code union.
 *
 * `VaultError` deliberately never carries a `cause`. An underlying driver or
 * Web Crypto error can hold key material, ciphertext, or plaintext in its
 * message or attached buffers; re-throwing it would leak that material into
 * logs and traces. Callers translate foreign errors into a code + a message
 * they authored themselves.
 */

/** Closed set of Vault failure reasons. */
export type VaultErrorCode =
  | "SEALED"
  | "NOT_INITIALIZED"
  | "SECRET_NOT_FOUND"
  | "INVALID_KEY"
  | "ALREADY_INITIALIZED"
  | "READONLY"
  | "EXPIRED"
  | "PERMISSION_DENIED"
  | "BACKEND_ERROR"
  | "INVALID_PATH"
  | "UNSUPPORTED"
  | "MISSING_PEER";

/**
 * Vault failure with a machine-readable {@link VaultErrorCode}.
 *
 * Never attach a `cause`: upstream crypto/driver errors may hold secret
 * material. Author a safe message instead.
 */
export class VaultError extends Error {
  /** Machine-readable reason. */
  readonly code: VaultErrorCode;

  /**
   * @param code - Machine-readable reason
   * @param message - Safe, secret-free description
   */
  constructor(code: VaultErrorCode, message: string) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}

/**
 * Whether a value is a {@link VaultError} (optionally of a specific code).
 *
 * @param value - Candidate
 * @param code - Narrow to a single code
 */
export function isVaultError(value: unknown, code?: VaultErrorCode): value is VaultError {
  if (!(value instanceof VaultError)) return false;
  return code === undefined || value.code === code;
}
