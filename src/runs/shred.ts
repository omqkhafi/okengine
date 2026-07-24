/**
 * Crypto-shredding for right-to-erasure on immutable Parquet partitions.
 *
 * Personal fields are encrypted with a per-subject key held in the Vault.
 * `oke privacy erase --subject <id>` deletes the key — archived bytes become
 * permanently unreadable without rewriting partitions (console §9.11).
 */

import type { VaultRuntime } from "../elements/vault.ts";

/** Prefix for per-subject shred keys in the Vault. */
export const SUBJECT_KEY_PREFIX = "oke.subject.";

/** Marker returned when a field cannot be decrypted (key shredded). */
export const SHREDDED = "[shredded]";

/**
 * Vault key name for a subject.
 *
 * @param subjectId - Subject identifier
 */
export function subjectKeyName(subjectId: string): string {
  return `${SUBJECT_KEY_PREFIX}${subjectId}`;
}

/** Minimal vault surface needed for subject keys. */
export interface SubjectKeyVault {
  /**
   * Read a secret by name.
   *
   * @param name - Secret name
   */
  read(name: string): string;
  /**
   * Write / overwrite a secret (mutable vault bags only).
   *
   * @param name - Secret name
   * @param value - Cleartext
   */
  put(name: string, value: string): void;
  /**
   * Delete a secret.
   *
   * @param name - Secret name
   */
  delete(name: string): boolean;
  /**
   * Whether a secret is present.
   *
   * @param name - Secret name
   */
  has(name: string): boolean;
}

/**
 * Adapt a {@link VaultRuntime} that supports put/delete into {@link SubjectKeyVault}.
 *
 * @param vault - Booted vault runtime with mutation support
 */
export function subjectKeysFromVault(vault: VaultRuntime): SubjectKeyVault {
  return {
    read(name) {
      return vault.read(name);
    },
    put(name, value) {
      if (typeof vault.put !== "function") {
        throw new Error("vault: put() required for subject keys");
      }
      vault.put(name, value);
    },
    delete(name) {
      if (typeof vault.delete !== "function") {
        throw new Error("vault: delete() required for subject-key erasure");
      }
      return vault.delete(name);
    },
    has(name) {
      return vault.names().includes(name);
    },
  };
}

/**
 * In-memory subject-key vault (tests / when no Vault element is wired).
 */
export function createMemorySubjectKeys(
  seed?: Readonly<Record<string, string>>,
): SubjectKeyVault {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    read(name) {
      const v = map.get(name);
      if (v === undefined) throw new Error(`subject key missing: ${name}`);
      return v;
    },
    put(name, value) {
      map.set(name, value);
    },
    delete(name) {
      return map.delete(name);
    },
    has(name) {
      return map.has(name);
    },
  };
}

/**
 * Ensure a per-subject AES-256 key exists; return raw key bytes.
 *
 * @param keys - Subject key vault
 * @param subjectId - Subject id
 */
export async function ensureSubjectKey(
  keys: SubjectKeyVault,
  subjectId: string,
): Promise<Uint8Array> {
  const name = subjectKeyName(subjectId);
  if (!keys.has(name)) {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    keys.put(name, Buffer.from(raw).toString("base64"));
    return raw;
  }
  return Buffer.from(keys.read(name), "base64");
}

/**
 * Encrypt cleartext fields under the subject's key.
 *
 * @param keys - Subject key vault
 * @param subjectId - Subject id
 * @param fields - Cleartext field map
 */
export async function archiveFields(
  keys: SubjectKeyVault,
  subjectId: string,
  fields: Readonly<Record<string, string>>,
): Promise<Record<string, string>> {
  const key = await ensureSubjectKey(keys, subjectId);
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(fields)) {
    out[name] = await encryptAesGcm(value, key);
  }
  return out;
}

/**
 * Decrypt archived fields. Missing / shredded keys yield {@link SHREDDED}.
 *
 * @param keys - Subject key vault
 * @param subjectId - Subject id
 * @param archived - Ciphertext field map
 */
export async function revealArchived(
  keys: SubjectKeyVault,
  subjectId: string,
  archived: Readonly<Record<string, string>>,
): Promise<Record<string, string>> {
  const name = subjectKeyName(subjectId);
  if (!keys.has(name)) {
    const shredded: Record<string, string> = {};
    for (const k of Object.keys(archived)) shredded[k] = SHREDDED;
    return shredded;
  }
  const key = Buffer.from(keys.read(name), "base64");
  const out: Record<string, string> = {};
  for (const [field, blob] of Object.entries(archived)) {
    try {
      out[field] = await decryptAesGcm(blob, key);
    } catch {
      out[field] = SHREDDED;
    }
  }
  return out;
}

/**
 * Erase a subject by deleting their Vault key (crypto-shred).
 *
 * @param keys - Subject key vault
 * @param subjectId - Subject id
 * @returns Whether a key was deleted
 */
export function eraseSubject(
  keys: SubjectKeyVault,
  subjectId: string,
): boolean {
  return keys.delete(subjectKeyName(subjectId));
}

async function encryptAesGcm(
  plaintext: string,
  keyBytes: Uint8Array,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyBuf = toArrayBuffer(keyBytes);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuf,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    new TextEncoder().encode(plaintext),
  );
  const packed = new Uint8Array(iv.length + cipher.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(cipher), iv.length);
  return Buffer.from(packed).toString("base64");
}

async function decryptAesGcm(
  blob: string,
  keyBytes: Uint8Array,
): Promise<string> {
  const packed = Buffer.from(blob, "base64");
  const iv = toArrayBuffer(packed.subarray(0, 12));
  const data = toArrayBuffer(packed.subarray(12));
  const keyBuf = toArrayBuffer(keyBytes);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuf,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) },
    cryptoKey,
    data,
  );
  return new TextDecoder().decode(plain);
}

/** Copy into a real ArrayBuffer for Web Crypto BufferSource typing. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
