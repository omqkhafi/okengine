/**
 * Domain-separated sealed OTP copy for Tier-2 redelivery.
 *
 * AES-GCM key is **never** the raw auth secret. It is derived via
 * HKDF-SHA-256 with info `oke-otp-seal-v1` so session HMAC material stays
 * cryptographically isolated from seal encryption.
 */

/** HKDF `info` — versioned; bump when the seal format changes. */
export const OTP_SEAL_HKDF_INFO = "oke-otp-seal-v1";

const INFO_BYTES = new TextEncoder().encode(OTP_SEAL_HKDF_INFO);
const EMPTY_SALT = new Uint8Array(0);

/**
 * Derive the AES-256-GCM key for OTP sealing from the method secret.
 *
 * @param secret - Root auth secret (`resolveMethodSecret`)
 */
export async function deriveOtpSealKey(secret: string): Promise<CryptoKey> {
  const ikm = new TextEncoder().encode(secret);
  const baseKey = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: EMPTY_SALT,
      info: INFO_BYTES,
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Seal a plaintext OTP for later redelivery (base64 `IV || ciphertext+tag`).
 *
 * @param secret - Root auth secret
 * @param otp - Raw OTP digits
 */
export async function sealOtp(secret: string, otp: string): Promise<string> {
  const key = await deriveOtpSealKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(otp),
  );
  const packed = new Uint8Array(iv.length + cipher.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(cipher), iv.length);
  return Buffer.from(packed).toString("base64");
}

/**
 * Unseal a previously sealed OTP. Call only at the deliberate delivery boundary.
 *
 * @param secret - Root auth secret
 * @param blob - Base64 sealed blob from {@link sealOtp}
 */
export async function unsealOtp(secret: string, blob: string): Promise<string> {
  const key = await deriveOtpSealKey(secret);
  const packed = Buffer.from(blob, "base64");
  if (packed.byteLength < 13) {
    throw new Error("otp-seal: malformed sealed blob");
  }
  const iv = packed.subarray(0, 12);
  const data = packed.subarray(12);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) },
    key,
    toArrayBuffer(data),
  );
  return new TextDecoder().decode(plain);
}

/** Copy into a real ArrayBuffer for Web Crypto BufferSource typing. */
function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}
