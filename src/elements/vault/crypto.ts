/**
 * Vault cryptography — Web Crypto only, no Node built-ins.
 *
 * Key hierarchy:
 *
 * ```text
 * master key (32 bytes, never stored in cleartext)
 *   ├─ HKDF "oke-vault-verify-v1"     → verify hash (detects a wrong key)
 *   ├─ HKDF "oke-vault-kek-v1"        → KEK        (wraps per-secret DEKs)
 *   └─ HKDF "oke-vault-backup-kek-v1" → backup KEK (wraps export bundles)
 * ```
 *
 * Every secret gets its own random DEK. The DEK encrypts the value with
 * AES-256-GCM; the KEK wraps the DEK with AES-256-GCM. Both bind the same
 * AAD ({@link buildAad}) so a ciphertext cannot be replayed under a
 * different path, version, algorithm, or KEK generation.
 *
 * Storage format: `iv` and `tag` are stored **separately** from
 * `ciphertext`. Web Crypto returns `ciphertext || tag` as one buffer, so
 * {@link encryptBytes} splits the trailing {@link GCM_TAG_BYTES} into `tag`
 * and {@link decryptBytes} re-joins them before calling `subtle.decrypt`.
 *
 * @see src/auth/otp-seal.ts for the same HKDF-then-AES-GCM shape.
 */

import { VaultError } from "./errors.ts";
import type { VaultAlgorithm } from "./types.ts";

/** Content-encryption algorithm persisted with every row. */
export const ALGORITHM: VaultAlgorithm = "aes-256-gcm";

/** HKDF `info` for the key-verification hash — bump on format change. */
export const HKDF_INFO_VERIFY = "oke-vault-verify-v1";

/** HKDF `info` for the key-encryption key — bump on format change. */
export const HKDF_INFO_KEK = "oke-vault-kek-v1";

/** HKDF `info` for the backup/export key-encryption key. */
export const HKDF_INFO_BACKUP_KEK = "oke-vault-backup-kek-v1";

/** Master key size in bytes (AES-256 keying material). */
export const MASTER_KEY_BYTES = 32;

/** Per-secret data-encryption key size in bytes. */
export const DEK_BYTES = 32;

/** AES-GCM nonce size in bytes (96-bit, the only NIST-recommended size). */
export const GCM_IV_BYTES = 12;

/** AES-GCM authentication tag size in bytes. */
export const GCM_TAG_BYTES = 16;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const EMPTY_SALT = new Uint8Array(0);

/** AES-GCM output split for storage: `iv`, `ciphertext`, `tag`. */
export interface SealedBytes {
  /** Random 12-byte nonce. Unique per encryption. */
  readonly iv: Uint8Array;
  /** Ciphertext without the trailing authentication tag. */
  readonly ciphertext: Uint8Array;
  /** 16-byte GCM authentication tag. */
  readonly tag: Uint8Array;
}

/**
 * Generate a fresh 32-byte master key.
 *
 * The caller owns the bytes: persist them out of band, then
 * {@link zeroBytes} the buffer.
 */
export function generateMasterKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(MASTER_KEY_BYTES));
}

/** Generate a fresh 32-byte per-secret data-encryption key. */
export function generateDek(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(DEK_BYTES));
}

/**
 * Derive the persisted verification hash for a master key.
 *
 * Stored in `oke_vault_master.key_hash`. An unseal attempt with the wrong
 * key produces a different hash, so it is rejected before any decryption
 * is attempted. The hash is a SHA-256 of HKDF-derived bytes, never of the
 * master key itself.
 *
 * @param masterKey - Raw 32-byte master key
 * @returns Lowercase hex SHA-256 digest
 */
export async function deriveVerifyHash(masterKey: Uint8Array): Promise<string> {
  assertMasterKey(masterKey);
  const bits = await hkdfBits(masterKey, HKDF_INFO_VERIFY, 32);
  const digest = await crypto.subtle.digest("SHA-256", bits);
  return toHex(new Uint8Array(digest));
}

/**
 * Derive the key-encryption key that wraps per-secret DEKs.
 *
 * @param masterKey - Raw 32-byte master key
 */
export function deriveKek(masterKey: Uint8Array): Promise<CryptoKey> {
  return deriveAesKey(masterKey, HKDF_INFO_KEK);
}

/**
 * Derive the backup key-encryption key used for export bundles.
 *
 * Domain-separated from {@link deriveKek} so a leaked backup key cannot
 * unwrap live DEKs.
 *
 * @param masterKey - Raw 32-byte master key
 */
export function deriveBackupKek(masterKey: Uint8Array): Promise<CryptoKey> {
  return deriveAesKey(masterKey, HKDF_INFO_BACKUP_KEK);
}

/**
 * Build the additional-authenticated-data binding for a secret version.
 *
 * Fields are joined with NUL, which {@link import("./path.ts").canonicalizePath}
 * forbids inside a path — so the encoding is unambiguous.
 *
 * @param path - Canonical path
 * @param version - Secret version
 * @param algorithm - Content-encryption algorithm
 * @param kekVersion - KEK generation that wrapped the DEK
 */
export function buildAad(
  path: string,
  version: number,
  algorithm: VaultAlgorithm,
  kekVersion: number,
): Uint8Array {
  return encoder.encode(
    ["oke-vault-v1", path, String(version), algorithm, String(kekVersion)].join("\0"),
  );
}

/**
 * Import raw key bytes as an AES-256-GCM key.
 *
 * @param raw - 32 key bytes (DEK or unwrapped KEK)
 */
export async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.byteLength !== DEK_BYTES) {
    throw new VaultError("INVALID_KEY", `vault: AES key must be ${DEK_BYTES} bytes`);
  }
  return crypto.subtle.importKey("raw", toArrayBuffer(raw), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypt arbitrary bytes under an AES-GCM key with bound AAD.
 *
 * @param key - AES-256-GCM key
 * @param plaintext - Bytes to protect
 * @param aad - Additional authenticated data from {@link buildAad}
 */
export async function encryptBytes(
  key: CryptoKey,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Promise<SealedBytes> {
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: toArrayBuffer(aad), tagLength: GCM_TAG_BYTES * 8 },
      key,
      toArrayBuffer(plaintext),
    ),
  );
  const split = sealed.byteLength - GCM_TAG_BYTES;
  return {
    iv,
    ciphertext: sealed.slice(0, split),
    tag: sealed.slice(split),
  };
}

/**
 * Decrypt bytes produced by {@link encryptBytes}.
 *
 * @param key - AES-256-GCM key
 * @param sealed - Stored `iv` / `ciphertext` / `tag`
 * @param aad - The exact AAD used at encryption time
 * @throws VaultError `INVALID_KEY` on a wrong key, tampered ciphertext, or mismatched AAD
 */
export async function decryptBytes(
  key: CryptoKey,
  sealed: SealedBytes,
  aad: Uint8Array,
): Promise<Uint8Array> {
  if (sealed.iv.byteLength !== GCM_IV_BYTES) {
    throw new VaultError("INVALID_KEY", `vault: iv must be ${GCM_IV_BYTES} bytes`);
  }
  if (sealed.tag.byteLength !== GCM_TAG_BYTES) {
    throw new VaultError("INVALID_KEY", `vault: auth tag must be ${GCM_TAG_BYTES} bytes`);
  }
  const joined = new Uint8Array(sealed.ciphertext.byteLength + sealed.tag.byteLength);
  joined.set(sealed.ciphertext, 0);
  joined.set(sealed.tag, sealed.ciphertext.byteLength);
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: new Uint8Array(sealed.iv),
        additionalData: toArrayBuffer(aad),
        tagLength: GCM_TAG_BYTES * 8,
      },
      key,
      toArrayBuffer(joined),
    );
    return new Uint8Array(plain);
  } catch {
    // Never surface the underlying error: it can echo key/ciphertext state.
    throw new VaultError("INVALID_KEY", "vault: decryption failed (wrong key or tampered data)");
  }
}

/**
 * Encrypt a secret value under its per-secret DEK.
 *
 * @param dek - Per-secret AES-256-GCM data-encryption key
 * @param plaintext - Cleartext value
 * @param aad - Additional authenticated data from {@link buildAad}
 */
export function encryptSecret(
  dek: CryptoKey,
  plaintext: string,
  aad: Uint8Array,
): Promise<SealedBytes> {
  return encryptBytes(dek, encoder.encode(plaintext), aad);
}

/**
 * Decrypt a secret value stored by {@link encryptSecret}.
 *
 * @param dek - Per-secret AES-256-GCM data-encryption key
 * @param sealed - Stored `iv` / `ciphertext` / `tag`
 * @param aad - The exact AAD used at encryption time
 */
export async function decryptSecret(
  dek: CryptoKey,
  sealed: SealedBytes,
  aad: Uint8Array,
): Promise<string> {
  const bytes = await decryptBytes(dek, sealed, aad);
  const text = decoder.decode(bytes);
  zeroBytes(bytes);
  return text;
}

/**
 * Wrap a per-secret DEK under the KEK, bound to the same AAD.
 *
 * @param kek - Key-encryption key from {@link deriveKek}
 * @param dek - Raw 32-byte data-encryption key
 * @param aad - Additional authenticated data from {@link buildAad}
 */
export function wrapDek(kek: CryptoKey, dek: Uint8Array, aad: Uint8Array): Promise<SealedBytes> {
  if (dek.byteLength !== DEK_BYTES) {
    throw new VaultError("INVALID_KEY", `vault: dek must be ${DEK_BYTES} bytes`);
  }
  return encryptBytes(kek, dek, aad);
}

/**
 * Unwrap a DEK sealed by {@link wrapDek}.
 *
 * The caller must {@link zeroBytes} the result once it has been imported.
 *
 * @param kek - Key-encryption key from {@link deriveKek}
 * @param sealed - Stored wrapped-DEK material
 * @param aad - The exact AAD used at wrap time
 */
export async function unwrapDek(
  kek: CryptoKey,
  sealed: SealedBytes,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const raw = await decryptBytes(kek, sealed, aad);
  if (raw.byteLength !== DEK_BYTES) {
    zeroBytes(raw);
    throw new VaultError("INVALID_KEY", "vault: unwrapped dek has the wrong length");
  }
  return raw;
}

/**
 * Overwrite a buffer in place.
 *
 * Best effort — the runtime may still hold copies — but it shortens the
 * window in which key material sits in a reachable heap object.
 *
 * @param buf - Buffer to clear
 */
export function zeroBytes(buf: Uint8Array): void {
  buf.fill(0);
}

/**
 * Compare two buffers without an early exit.
 *
 * Length inequality is reported immediately (lengths are not secret);
 * equal-length contents are compared with a full XOR accumulation.
 *
 * @param a - Left buffer
 * @param b - Right buffer
 */
export function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Compare two hex/base64 strings without an early exit.
 *
 * @param a - Left string
 * @param b - Right string
 */
export function constantTimeEqualStrings(a: string, b: string): boolean {
  return constantTimeEqualBytes(encoder.encode(a), encoder.encode(b));
}

/**
 * Encode a master key as base64 for out-of-band storage.
 *
 * @param masterKey - Raw 32-byte master key
 */
export function masterKeyToBase64(masterKey: Uint8Array): string {
  assertMasterKey(masterKey);
  return Buffer.from(masterKey).toString("base64");
}

/**
 * Decode a base64 master key.
 *
 * @param encoded - Base64 text
 * @throws VaultError `INVALID_KEY` when the decoded key is not 32 bytes
 */
export function masterKeyFromBase64(encoded: string): Uint8Array {
  const trimmed = encoded.trim();
  if (trimmed.length === 0) {
    throw new VaultError("INVALID_KEY", "vault: master key is empty");
  }
  const decoded = new Uint8Array(Buffer.from(trimmed, "base64"));
  if (decoded.byteLength !== MASTER_KEY_BYTES) {
    zeroBytes(decoded);
    throw new VaultError("INVALID_KEY", `vault: master key must be ${MASTER_KEY_BYTES} bytes`);
  }
  return decoded;
}

/**
 * Lowercase hex encoding.
 *
 * @param bytes - Buffer to encode
 */
export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

/**
 * Reject anything that is not a 32-byte master key.
 *
 * @param masterKey - Candidate
 */
function assertMasterKey(masterKey: Uint8Array): void {
  if (masterKey.byteLength !== MASTER_KEY_BYTES) {
    throw new VaultError("INVALID_KEY", `vault: master key must be ${MASTER_KEY_BYTES} bytes`);
  }
}

/**
 * HKDF-SHA-256 raw output.
 *
 * @param masterKey - Input keying material
 * @param info - Domain-separation label
 * @param bytes - Output length in bytes
 */
async function hkdfBits(masterKey: Uint8Array, info: string, bytes: number): Promise<ArrayBuffer> {
  const baseKey = await crypto.subtle.importKey("raw", toArrayBuffer(masterKey), "HKDF", false, [
    "deriveBits",
  ]);
  return crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: EMPTY_SALT, info: encoder.encode(info) },
    baseKey,
    bytes * 8,
  );
}

/**
 * HKDF-SHA-256 to a non-extractable AES-256-GCM key.
 *
 * @param masterKey - Raw 32-byte master key
 * @param info - Domain-separation label
 */
async function deriveAesKey(masterKey: Uint8Array, info: string): Promise<CryptoKey> {
  assertMasterKey(masterKey);
  const baseKey = await crypto.subtle.importKey("raw", toArrayBuffer(masterKey), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: EMPTY_SALT, info: encoder.encode(info) },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Copy into a real `ArrayBuffer` for Web Crypto `BufferSource` typing.
 *
 * @param view - Source bytes
 */
function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}
