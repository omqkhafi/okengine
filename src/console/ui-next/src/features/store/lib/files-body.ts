/**
 * Files object body — base64 / UTF-8 encode for console get / put / download.
 */

/**
 * Encode bytes as standard base64 (no wrapping).
 *
 * @param bytes - Object bytes
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Decode standard base64 to bytes.
 *
 * @param body - Base64 payload
 */
export function base64ToBytes(body: string): Uint8Array {
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * UTF-8 encode a string to base64.
 *
 * @param text - UTF-8 text
 */
export function utf8ToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

/**
 * Decode a console object body (`utf8` or `base64`) to bytes.
 *
 * @param encoding - Wire encoding
 * @param body - Payload
 */
export function decodeFileBody(encoding: "utf8" | "base64", body: string): Uint8Array {
  if (encoding === "utf8") return new TextEncoder().encode(body);
  return base64ToBytes(body);
}

/**
 * Trigger a browser download for object bytes.
 *
 * @param filename - Suggested name
 * @param bytes - Object bytes
 * @param contentType - MIME type
 */
export function downloadFileBytes(filename: string, bytes: Uint8Array, contentType: string): void {
  const blob = new Blob([bytesToArrayBuffer(bytes)], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Copy bytes onto a standalone {@link ArrayBuffer} for `Blob` / download.
 *
 * @param bytes - Object bytes
 */
export function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
