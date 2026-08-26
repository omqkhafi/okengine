/**
 * Envelope sealing for opt-in provider-token storage.
 *
 * Vault paths hold one sealed blob per provider; inside, an AES-GCM-sealed
 * map keyed by user id. The seal key is HKDF-derived from the auth secret
 * with a domain-separated info string (never the session HMAC material) —
 * same pattern as `otp-seal`.
 */

/** HKDF `info` — versioned; bump when the envelope format changes. */
export const OAUTH_TOKEN_SEAL_HKDF_INFO = "oke-oauth-token-seal-v1";

const INFO_BYTES = new TextEncoder().encode(OAUTH_TOKEN_SEAL_HKDF_INFO);
const EMPTY_SALT = new Uint8Array(0);

async function deriveSealKey(secret: string): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: EMPTY_SALT, info: INFO_BYTES },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Seal a cleartext payload to `IV || ciphertext+tag`, base64-encoded.
 *
 * @param secret - Root auth secret
 * @param plaintext - Cleartext bytes/string
 */
export async function sealTokenBlob(secret: string, plaintext: string): Promise<string> {
  const key = await deriveSealKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const packed = new Uint8Array(iv.length + cipher.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(cipher), iv.length);
  return Buffer.from(packed).toString("base64");
}

/**
 * Open a blob produced by {@link sealTokenBlob}.
 *
 * @param secret - Root auth secret
 * @param blob - Base64 sealed blob
 */
export async function openTokenBlob(secret: string, blob: string): Promise<string> {
  const key = await deriveSealKey(secret);
  const packed = Buffer.from(blob, "base64");
  if (packed.byteLength < 13) throw new Error("oauth-token-seal: malformed blob");
  const iv = new Uint8Array(packed.subarray(0, 12));
  const data = packed.subarray(12);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(data),
  );
  return new TextDecoder().decode(plain);
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

/**
 * Seal a full per-user token map (the vault path value).
 *
 * @param secret - Root auth secret
 * @param envelope - userId → sealed per-user blob
 */
export async function sealTokenEnvelope(
  secret: string,
  envelopeJson: string,
): Promise<string> {
  return sealTokenBlob(secret, envelopeJson);
}

/**
 * Open a vault path value into its per-user token map.
 *
 * @param secret - Root auth secret
 * @param sealed - Sealed envelope JSON
 */
export async function unsealTokenEnvelope(
  secret: string,
  sealed: string,
): Promise<Record<string, string>> {
  return JSON.parse(await openTokenBlob(secret, sealed)) as Record<string, string>;
}
