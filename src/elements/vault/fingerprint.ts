/**
 * Secret fingerprints — Console / traces show these, never cleartext.
 */

/**
 * SHA-256 fingerprint of a secret value (first 16 hex chars).
 *
 * @param value - Cleartext secret
 */
export async function fingerprintSecret(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex.slice(0, 16)}`;
}

/**
 * Synchronous fingerprint using Bun's hasher when available (boot / logs).
 *
 * @param value - Cleartext secret
 */
export function fingerprintSecretSync(value: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return `sha256:${hasher.digest("hex").slice(0, 16)}`;
}
