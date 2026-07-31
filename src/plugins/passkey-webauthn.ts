/**
 * Minimal WebAuthn assertion / registration verifier (ES256 / P-256).
 *
 * Validates clientDataJSON (type · challenge · origin), authenticatorData
 * (rpId hash · user-presence), and ECDSA signature over
 * `authenticatorData || SHA-256(clientDataJSON)` against a stored SPKI public key.
 */

import { constantTimeEqual } from "../auth/constant-time.ts";

/** Result of a failed WebAuthn verify. */
export type WebAuthnVerifyFailure = {
  readonly ok: false;
  readonly reason: string;
};

/** Successful assertion verify (with updated sign counter). */
export type WebAuthnVerifySuccess = {
  readonly ok: true;
  readonly signCount: number;
};

/** Options for {@link verifyWebAuthnCeremony}. */
export interface WebAuthnVerifyOptions {
  readonly expectedType: "webauthn.create" | "webauthn.get";
  readonly expectedChallenge: string;
  readonly expectedOrigins: readonly string[];
  readonly rpId: string;
  /** Base64url SPKI (SubjectPublicKeyInfo) of the credential public key. */
  readonly publicKeySpkiB64url: string;
  /** Base64url clientDataJSON bytes. */
  readonly clientDataJSON: string;
  /** Base64url authenticatorData bytes. */
  readonly authenticatorData: string;
  /** Base64url ECDSA P-1363 signature. */
  readonly signature: string;
  /** Previous stored sign counter (authenticate only). */
  readonly previousSignCount?: number;
}

/**
 * Verify a WebAuthn create/get ceremony payload.
 *
 * @param opts - Expected RP values + assertion fields
 */
export async function verifyWebAuthnCeremony(
  opts: WebAuthnVerifyOptions,
): Promise<WebAuthnVerifySuccess | WebAuthnVerifyFailure> {
  let clientDataBytes: Uint8Array;
  let authData: Uint8Array;
  let signature: Uint8Array;
  try {
    clientDataBytes = b64urlDecode(opts.clientDataJSON);
    authData = b64urlDecode(opts.authenticatorData);
    signature = b64urlDecode(opts.signature);
  } catch {
    return { ok: false, reason: "invalid_credentials" };
  }

  if (authData.length < 37) return { ok: false, reason: "invalid_credentials" };

  let clientData: { type?: unknown; challenge?: unknown; origin?: unknown };
  try {
    clientData = JSON.parse(new TextDecoder().decode(clientDataBytes)) as typeof clientData;
  } catch {
    return { ok: false, reason: "invalid_credentials" };
  }

  if (typeof clientData.type !== "string" || clientData.type !== opts.expectedType) {
    return { ok: false, reason: "invalid_credentials" };
  }
  if (typeof clientData.challenge !== "string") {
    return { ok: false, reason: "invalid_credentials" };
  }
  if (!constantTimeEqual(clientData.challenge, opts.expectedChallenge)) {
    return { ok: false, reason: "invalid_credentials" };
  }
  if (typeof clientData.origin !== "string") {
    return { ok: false, reason: "invalid_credentials" };
  }
  if (!opts.expectedOrigins.includes(clientData.origin)) {
    return { ok: false, reason: "invalid_origin" };
  }

  const rpHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(opts.rpId)),
  );
  for (let i = 0; i < 32; i++) {
    if (authData[i] !== rpHash[i]) return { ok: false, reason: "invalid_credentials" };
  }

  const flags = authData[32]!;
  // User Present (bit 0) required.
  if ((flags & 0x01) === 0) return { ok: false, reason: "invalid_credentials" };

  const signCount =
    ((authData[33]! << 24) | (authData[34]! << 16) | (authData[35]! << 8) | authData[36]!) >>> 0;

  if (opts.previousSignCount !== undefined) {
    // Spec: if both non-zero, authenticator count must strictly increase.
    if (opts.previousSignCount > 0 && signCount > 0 && signCount <= opts.previousSignCount) {
      return { ok: false, reason: "invalid_credentials" };
    }
  }

  const clientDataHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", asBufferSource(clientDataBytes)),
  );
  const signed = new Uint8Array(authData.length + clientDataHash.length);
  signed.set(authData, 0);
  signed.set(clientDataHash, authData.length);

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "spki",
      asBufferSource(b64urlDecode(opts.publicKeySpkiB64url)),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
  } catch {
    return { ok: false, reason: "invalid_credentials" };
  }

  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    asBufferSource(signature),
    asBufferSource(signed),
  );
  if (!valid) return { ok: false, reason: "invalid_credentials" };

  return { ok: true, signCount };
}

/**
 * Encode bytes as unpadded base64url.
 *
 * @param bytes - Raw bytes
 */
export function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decode unpadded base64url to bytes.
 *
 * @param input - Base64url string
 */
export function b64urlDecode(input: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (input.length % 4)) % 4);
  const b64 = (input + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Build minimal authenticatorData (rpIdHash · flags · signCount).
 *
 * @param rpId - Relying party id
 * @param signCount - Counter
 * @param flags - Flag byte (default UP=0x01)
 */
export async function buildAuthenticatorData(
  rpId: string,
  signCount: number,
  flags = 0x01,
): Promise<Uint8Array> {
  const rpHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rpId)),
  );
  const out = new Uint8Array(37);
  out.set(rpHash, 0);
  out[32] = flags;
  out[33] = (signCount >>> 24) & 0xff;
  out[34] = (signCount >>> 16) & 0xff;
  out[35] = (signCount >>> 8) & 0xff;
  out[36] = signCount & 0xff;
  return out;
}

/**
 * Sign `authenticatorData || SHA-256(clientDataJSON)` with an ECDSA P-256 key.
 *
 * @param privateKey - Signer
 * @param authenticatorData - Auth data bytes
 * @param clientDataJSON - Raw clientDataJSON bytes
 */
export async function signWebAuthnAssertion(
  privateKey: CryptoKey,
  authenticatorData: Uint8Array,
  clientDataJSON: Uint8Array,
): Promise<Uint8Array> {
  const clientDataHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", asBufferSource(clientDataJSON)),
  );
  const signed = new Uint8Array(authenticatorData.length + clientDataHash.length);
  signed.set(authenticatorData, 0);
  signed.set(clientDataHash, authenticatorData.length);
  return new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      asBufferSource(signed),
    ),
  );
}

/** Fresh buffer for Web Crypto `BufferSource` typing. */
function asBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}
