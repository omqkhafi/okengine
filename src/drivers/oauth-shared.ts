/**
 * Hand-rolled OAuth/OIDC primitives — `crypto.subtle` only, no external
 * library (locked decision). Mirrors the MCP/Gate precedent: injectable
 * fetch, explicit errors, strict parsing.
 */

import {
  OAuthProtocolError,
  type OAuthAuthorizeInput,
  type OAuthDriverId,
} from "./oauth-types.ts";

/** Parsed JWT parts. */
export interface ParsedJwt {
  readonly header: Record<string, unknown>;
  readonly payload: Record<string, unknown>;
  /** base64url signature segment. */
  readonly signature: string;
  /** Signed segments (`header.payload`) for `crypto.subtle.verify`. */
  readonly signedPart: string;
}

/**
 * Parse a compact JWS without verifying — verification is always explicit.
 * Rejects non-JWT shapes and embedded JSON web tokens.
 *
 * @param token - Compact JWT
 */
export function parseJwt(token: string): ParsedJwt {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new OAuthProtocolError("malformed_id_token", "ID token is not a compact JWS");
  }
  const header = decodeSegment<Record<string, unknown>>(parts[0]!);
  const payload = decodeSegment<Record<string, unknown>>(parts[1]!);
  return { header, payload, signature: parts[2]!, signedPart: `${parts[0]}.${parts[1]}` };
}

function decodeSegment<T>(segment: string): T {
  const bytes = base64UrlDecode(segment);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new OAuthProtocolError("malformed_id_token", "JWT segment is not valid JSON");
  }
}

/** Decode a base64url string to bytes. */
export function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Encode bytes to base64url without padding. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/**
 * Generate a PKCE code verifier: 43–128 chars from the RFC 7636 alphabet
 * (`A–Z a–z 0–9 -._~`), ~96 chars of entropy here.
 */
export function generateCodeVerifier(): string {
  return randomUrlSafe(72);
}

/** Generate a URL-safe opaque token (~192 bits entropy). */
export function generateState(): string {
  return randomUrlSafe(24);
}

function randomUrlSafe(bytes: number): string {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  // Map to the unreserved alphabet; 64 symbols per byte keeps full entropy.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let out = "";
  for (const b of raw) out += alphabet[b % 64]!;
  return out;
}

/**
 * Derive the S256 PKCE challenge for a verifier.
 *
 * @param verifier - Code verifier
 */
export async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Verify an RS256 / ES256 JWT signature against a JWK.
 *
 * @param parsed - Pre-parsed token
 * @param jwk - Public key from the provider JWKS
 */
export async function verifyJwtSignature(parsed: ParsedJwt, jwk: Record<string, unknown>): Promise<void> {
  const alg = typeof jwk.alg === "string" ? jwk.alg : parsed.header["alg"];
  if (alg !== "RS256" && alg !== "ES256") {
    throw new OAuthProtocolError("unsupported_alg", `Unsupported ID token alg: ${String(alg)}`);
  }
  const key = await importJwk(jwk, alg);
  // WebCrypto ECDSA consumes the IEEE P-1363 raw form — which is exactly the
  // JOSE wire format, so RS256-style DER conversion never applies here.
  const signatureBytes = base64UrlDecode(parsed.signature);
  const ok = await crypto.subtle.verify(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (alg === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : "RSASSA-PKCS1-v1_5") as any,
    key,
    toArrayBuffer(signatureBytes),
    toArrayBuffer(new TextEncoder().encode(parsed.signedPart)),
  );
  if (!ok) {
    throw new OAuthProtocolError("bad_signature", "ID token signature verification failed");
  }
}

async function importJwk(jwk: Record<string, unknown>, alg: "RS256" | "ES256"): Promise<CryptoKey> {
  const normalized =
    alg === "ES256"
      ? { kty: "EC", crv: "P-256", x: jwk["x"], y: jwk["y"] }
      : { kty: "RSA", n: jwk["n"], e: jwk["e"] };
  const format = "jwk" as const;
  return crypto.subtle.importKey(
    format,
    normalized as unknown as { kty: string; crv?: string; x?: string; y?: string; n?: string; e?: string },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (alg === "ES256"
      ? { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" }
      : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }) as any,
    false,
    ["verify"],
  );
}

/** Copy a view into a fresh ArrayBuffer for WebCrypto BufferSource typing. */
export function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

/**
 * Fetch and cache a provider JWKS document.
 *
 * @param url - JWKS endpoint
 * @param fetchFn - Injectable fetch
 * @param cache - Process-wide cache keyed by URL
 */
export async function fetchJwks(
  url: string,
  fetchFn: typeof globalThis.fetch,
  cache: Map<string, { keys: ReadonlyArray<Record<string, unknown>>; fetchedAt: number }> = globalJwksCache,
): Promise<ReadonlyArray<Record<string, unknown>>> {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;
  const res = await fetchFn(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new OAuthProtocolError("jwks_fetch_failed", `JWKS fetch failed with HTTP ${res.status}`);
  }
  const body = (await res.json()) as { keys?: ReadonlyArray<Record<string, unknown>> };
  if (!Array.isArray(body.keys)) {
    throw new OAuthProtocolError("jwks_fetch_failed", "JWKS response missing keys array");
  }
  cache.set(url, { keys: body.keys, fetchedAt: Date.now() });
  return body.keys;
}

const globalJwksCache = new Map<string, { keys: ReadonlyArray<Record<string, unknown>>; fetchedAt: number }>();
const JWKS_TTL_MS = 10 * 60_000;

/**
 * Drop a cached JWKS document (key-rotation retry).
 *
 * @param url - JWKS endpoint
 */
export function clearJwksCache(url: string): void {
  globalJwksCache.delete(url);
}

/**
 * Pick the JWKS key matching the token's `kid` (falls back when only one key).
 *
 * @param keys - Provider keys
 * @param kid - Token `kid`
 */
export function selectJwksKey(
  keys: ReadonlyArray<Record<string, unknown>>,
  kid: unknown,
): Record<string, unknown> {
  if (typeof kid === "string") {
    const match = keys.find((k) => k["kid"] === kid);
    if (match) return match;
  }
  if (keys.length === 1) return keys[0]!;
  throw new OAuthProtocolError("unknown_kid", "No JWKS key matches the ID token kid");
}

/**
 * Build a form-encoded request init for token endpoints.
 *
 * @param params - Body parameters
 * @param headers - Extra headers
 */
export function formPost(
  params: Readonly<Record<string, string>>,
  headers: Readonly<Record<string, string>> = {},
): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      ...headers,
    },
    body: new URLSearchParams(params).toString(),
  };
}

/**
 * Require a string field on a provider JSON response.
 *
 * @param source - Response object
 * @param path - Dotted path (e.g. `"data.id"`)
 * @param provider - Driver id for error context
 */
export function requireString(
  source: Readonly<Record<string, unknown>>,
  path: string,
  provider: OAuthDriverId,
): string {
  const value = pickPath(source, path);
  if (typeof value !== "string" || value.length === 0) {
    throw new OAuthProtocolError("profile_error", `${provider}: missing ${path}`);
  }
  return value;
}

/**
 * Read a dotted path off a provider response.
 *
 * @param source - Response object
 * @param path - Dotted path
 */
export function pickPath(source: Readonly<Record<string, unknown>>, path: string): unknown {
  let cur: unknown = source;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * Conservative email-verified parser — the GHSA-6g38-8j4p-j3pr defense.
 *
 * Truthy ONLY for boolean `true` or the exact strings `"true"` / `"1"`.
 * Apple's `"false"` string and every absent / null / numeric value collapse
 * to `false`. Never trust provider truthiness.
 *
 * @param value - Raw provider claim
 */
export function parseEmailVerified(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") return value === "true" || value === "1";
  return false;
}

/**
 * Normalize an optional email claim: absent/null → undefined, else trimmed
 * lowercase string.
 *
 * @param value - Raw provider claim
 */
export function normalizeEmail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Authorize-input fields shared by every driver's URL builder. */
export type CommonAuthorizeInput = OAuthAuthorizeInput;

/**
 * Append authorize query parameters onto a base authorization URL.
 *
 * @param base - Authorization endpoint
 * @param input - Authorize inputs
 * @param extra - Provider-specific parameters
 */
export function buildAuthorizeQuery(
  base: string,
  input: CommonAuthorizeInput,
  extra: Readonly<Record<string, string>> = {},
): string {
  const url = new URL(base);
  const params = url.searchParams;
  params.set("response_type", "code");
  params.set("client_id", input.clientId);
  params.set("redirect_uri", input.redirectUri);
  params.set("scope", input.scopes.join(" "));
  params.set("state", input.state);
  params.set("code_challenge", input.codeChallenge);
  params.set("code_challenge_method", "S256");
  if (input.nonce !== undefined) params.set("nonce", input.nonce);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  return url.toString();
}
