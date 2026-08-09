/**
 * Unsealers — the only objects allowed to hold master-key material.
 *
 * A master key lives in a closure, never on an exported object and never
 * on `globalThis`. {@link Unsealer.seal} overwrites the buffer and flips
 * the instance permanently sealed; every later derivation fails with
 * `SEALED`. Restoring service after a seal requires a fresh unsealer built
 * from the key source again.
 */

import {
  deriveBackupKek,
  deriveKek,
  deriveVerifyHash,
  MASTER_KEY_BYTES,
  masterKeyFromBase64,
  zeroBytes,
} from "./crypto.ts";
import { VaultError } from "./errors.ts";

/** Holder of master-key material with a one-way seal. */
export interface Unsealer {
  /** Whether the master key has been zeroed. */
  readonly sealed: boolean;
  /** Derive the key-encryption key that wraps per-secret DEKs. */
  unwrapKek(): Promise<CryptoKey>;
  /** Derive the backup key-encryption key used for export bundles. */
  unwrapBackupKek(): Promise<CryptoKey>;
  /** Derive the persisted verification hash for this master key. */
  verifyHash(): Promise<string>;
  /** Zero the master key. Idempotent and irreversible for this instance. */
  seal(): void;
}

/**
 * Build an unsealer over a copy of `key`.
 *
 * The caller's buffer is copied, so the caller remains responsible for
 * zeroing its own copy.
 *
 * @param key - Raw 32-byte master key
 * @throws VaultError `INVALID_KEY` when the key is not 32 bytes
 */
function createUnsealer(key: Uint8Array): Unsealer {
  if (key.byteLength !== MASTER_KEY_BYTES) {
    throw new VaultError("INVALID_KEY", `vault: master key must be ${MASTER_KEY_BYTES} bytes`);
  }
  let sealed = false;
  const material = new Uint8Array(MASTER_KEY_BYTES);
  material.set(key);

  /** Master key or `SEALED`. */
  function requireKey(): Uint8Array {
    if (sealed) {
      throw new VaultError("SEALED", "vault: sealed — master key is not available");
    }
    return material;
  }

  return {
    get sealed() {
      return sealed;
    },
    async unwrapKek() {
      return deriveKek(requireKey());
    },
    async unwrapBackupKek() {
      return deriveBackupKek(requireKey());
    },
    async verifyHash() {
      return deriveVerifyHash(requireKey());
    },
    seal() {
      sealed = true;
      zeroBytes(material);
    },
  };
}

/**
 * Unsealer from a raw key already in memory (tests, `memory` key source).
 *
 * @param key - Raw 32-byte master key
 */
export function createMemoryUnsealer(key: Uint8Array): Unsealer {
  return createUnsealer(key);
}

/**
 * Unsealer from an environment-supplied key.
 *
 * @param key - Raw 32-byte master key decoded from the environment
 */
export function createEnvUnsealer(key: Uint8Array): Unsealer {
  return createUnsealer(key);
}

/**
 * Unsealer from a base64 master key (environment variables, CLI flags).
 *
 * @param encoded - Base64 master key
 */
export function createUnsealerFromBase64(encoded: string): Unsealer {
  const key = masterKeyFromBase64(encoded);
  try {
    return createUnsealer(key);
  } finally {
    zeroBytes(key);
  }
}

/**
 * Unsealer from a key file.
 *
 * The file holds either exactly 32 raw bytes or base64 text (with optional
 * surrounding whitespace).
 *
 * @param path - Key file path
 * @throws VaultError `NOT_INITIALIZED` when the file is missing or unreadable
 * @throws VaultError `INVALID_KEY` when the contents are not a 32-byte key
 */
export async function createFileUnsealer(path: string): Promise<Unsealer> {
  let raw: Uint8Array;
  try {
    raw = new Uint8Array(await Bun.file(path).arrayBuffer());
  } catch {
    // Never surface the filesystem error: its message may echo the path chain.
    throw new VaultError("NOT_INITIALIZED", "vault: master key file is missing or unreadable");
  }

  if (raw.byteLength === MASTER_KEY_BYTES) {
    try {
      return createUnsealer(raw);
    } finally {
      zeroBytes(raw);
    }
  }

  const text = new TextDecoder().decode(raw).trim();
  zeroBytes(raw);
  if (text.length === 0) {
    throw new VaultError("INVALID_KEY", "vault: master key file is empty");
  }
  const decoded = masterKeyFromBase64(text);
  try {
    return createUnsealer(decoded);
  } finally {
    zeroBytes(decoded);
  }
}
