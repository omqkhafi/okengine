/**
 * Shared OIDC machinery: discovery caching, ID token verification
 * (signature → iss → aud/azp → exp → nonce) and the ES256 client-secret JWT
 * Apple requires. Hand-rolled on `crypto.subtle`.
 */

import { OAuthProtocolError, type OAuthDriverId } from "./oauth-types.ts";
import {
  base64UrlEncode,
  fetchJwks,
  generateState,
  parseJwt,
  selectJwksKey,
  verifyJwtSignature,
} from "./oauth-shared.ts";

/** Force a JWKS re-fetch bypassing the cache. */
async function fetchJwksFresh(
  url: string,
  fetchFn: typeof globalThis.fetch,
): Promise<ReadonlyArray<Record<string, unknown>>> {
  const { clearJwksCache } = await import("./oauth-shared.ts");
  clearJwksCache(url);
  return fetchJwks(url, fetchFn);
}

/** Cached OpenID discovery document. */
interface DiscoveryCacheEntry {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
  readonly fetchedAt: number;
}

const globalDiscoveryCache = new Map<string, DiscoveryCacheEntry>();
const DISCOVERY_TTL_MS = 60 * 60_000;

/**
 * Fetch (and cache) `/.well-known/openid-configuration` endpoints.
 *
 * @param issuer - Issuer / discovery origin (Microsoft `{tenantid}` templates allowed)
 * @param fetchFn - Injectable fetch
 */
export async function discoverOpenId(
  issuer: string,
  fetchFn: typeof globalThis.fetch,
): Promise<{ authorizationEndpoint: string; tokenEndpoint: string; jwksUri: string }> {
  const cached = globalDiscoveryCache.get(issuer);
  if (cached && Date.now() - cached.fetchedAt < DISCOVERY_TTL_MS) return cached;
  const wellKnown = `${issuer.endsWith("/") ? issuer : `${issuer}/`}.well-known/openid-configuration`;
  const res = await fetchFn(wellKnown, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new OAuthProtocolError(
      "discovery_failed",
      `OIDC discovery failed with HTTP ${res.status}`,
    );
  }
  const doc = (await res.json()) as Record<string, unknown>;
  const authorizationEndpoint = doc["authorization_endpoint"];
  const tokenEndpoint = doc["token_endpoint"];
  const jwksUri = doc["jwks_uri"];
  if (
    typeof authorizationEndpoint !== "string" ||
    typeof tokenEndpoint !== "string" ||
    typeof jwksUri !== "string"
  ) {
    throw new OAuthProtocolError(
      "discovery_failed",
      "Discovery document missing required endpoints",
    );
  }
  const entry = { authorizationEndpoint, tokenEndpoint, jwksUri, fetchedAt: Date.now() };
  globalDiscoveryCache.set(issuer, entry);
  return entry;
}

/** Verified ID-token claims. */
export interface VerifiedClaims {
  readonly header: Record<string, unknown>;
  readonly payload: Record<string, unknown>;
  /** Token `iss`. */
  readonly issuer: string;
  /** Token subject. */
  readonly subject: string;
}

/**
 * Verify an OIDC ID token end-to-end and return its claims.
 *
 * Order matters: signature first, then issuer equality against the flow's
 * stored expectation (RFC 9207 mix-up defense), then audience, expiry, nonce.
 *
 * @param options - Token + expectations + JWKS location
 */
export async function verifyIdToken(options: {
  readonly idToken: string;
  readonly jwksUri: string;
  readonly expectedIssuer: string;
  readonly expectedAudience: string;
  readonly expectedNonce?: string;
  readonly fetchFn: typeof globalThis.fetch;
  readonly now?: () => number;
}): Promise<VerifiedClaims> {
  const parsed = parseJwt(options.idToken);
  const attempt = async (keys: ReadonlyArray<Record<string, unknown>>): Promise<void> => {
    const key = selectJwksKey(keys, parsed.header["kid"]);
    await verifyJwtSignature(parsed, key);
  };
  try {
    await attempt(await fetchJwks(options.jwksUri, options.fetchFn));
  } catch (err) {
    // Key-rotation window: one forced refresh on an unknown kid.
    if (err instanceof OAuthProtocolError && err.reason === "unknown_kid") {
      await attempt(await fetchJwksFresh(options.jwksUri, options.fetchFn));
    } else {
      throw err;
    }
  }

  const iss = parsed.payload["iss"];
  if (typeof iss !== "string" || iss !== options.expectedIssuer) {
    throw new OAuthProtocolError(
      "issuer_mismatch",
      `ID token iss ${String(iss)} does not match the initiated provider`,
    );
  }
  assertAudience(parsed.payload, options.expectedAudience);

  const now = (options.now ?? (() => Date.now()))();
  const exp = parsed.payload["exp"];
  if (typeof exp !== "number" || now >= exp * 1000) {
    throw new OAuthProtocolError("expired_id_token", "ID token expired");
  }

  if (options.expectedNonce !== undefined) {
    const nonce = parsed.payload["nonce"];
    if (nonce !== options.expectedNonce) {
      throw new OAuthProtocolError("nonce_mismatch", "ID token nonce does not match");
    }
  }

  const sub = parsed.payload["sub"];
  if (typeof sub !== "string" || sub.length === 0) {
    throw new OAuthProtocolError("malformed_id_token", "ID token missing sub claim");
  }
  return { header: parsed.header, payload: parsed.payload, issuer: iss, subject: sub };
}

/**
 * Audience check per OIDC Core: `aud` must contain the client id; when it
 * lists multiple audiences an explicit matching `azp` is required.
 *
 * @param payload - ID token claims
 * @param clientId - Expected client audience
 */
export function assertAudience(payload: Record<string, unknown>, clientId: string): void {
  const aud = payload["aud"];
  const auds = Array.isArray(aud) ? aud.map(String) : typeof aud === "string" ? [aud] : [];
  if (!auds.includes(clientId)) {
    throw new OAuthProtocolError("aud_mismatch", "ID token aud does not include this client");
  }
  if (auds.length > 1) {
    const azp = payload["azp"];
    if (azp !== clientId) {
      throw new OAuthProtocolError("azp_mismatch", "Multi-audience ID token missing azp=client_id");
    }
  }
}

/**
 * Mint a fresh Apple client-secret JWT (ES256, 6-month ceiling — we use 1h).
 *
 * @param options - Private key PEM (PKCS#8), team/key/client ids, clock
 */
export async function createAppleClientSecretJwt(options: {
  readonly privateKeyPem: string;
  readonly teamId: string;
  readonly keyId: string;
  readonly clientId: string;
  readonly now?: () => number;
}): Promise<string> {
  const now = Math.floor((options.now ?? (() => Date.now()))() / 1000);
  const pkcs8 = parsePemBody(options.privateKeyPem);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as any,
    false,
    ["sign"],
  );
  const enc = new TextEncoder();
  const header = base64UrlEncode(enc.encode(JSON.stringify({ alg: "ES256", kid: options.keyId })));
  const payload = base64UrlEncode(
    enc.encode(
      JSON.stringify({
        iss: options.teamId,
        iat: now,
        exp: now + 3600,
        aud: "https://appleid.apple.com",
        sub: options.clientId,
      }),
    ),
  );
  const derSig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      enc.encode(`${header}.${payload}`),
    ),
  );
  // Bun's WebCrypto emits the raw P-1363 form (r‖s) — already JOSE-shaped.
  const joseSig = rawToJose(derSig.subarray(0, 32), derSig.subarray(32));
  return `${header}.${payload}.${joseSig}`;
}

function parsePemBody(pem: string): ArrayBuffer {
  const body = pem
    .replaceAll("-----BEGIN PRIVATE KEY-----", "")
    .replaceAll("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer as ArrayBuffer;
}

/** Convert ASN.1 DER ECDSA sig to JOSE fixed-width 64-byte form. */
export function derToJose(der: Uint8Array): string {
  let offset = 2;
  if (der[0] !== 0x30) throw new OAuthProtocolError("client_secret_jwt", "Bad DER sequence");
  const readInt = (): Uint8Array => {
    if (der[offset] !== 0x02) throw new OAuthProtocolError("client_secret_jwt", "Bad DER integer");
    const len = der[offset + 1]!;
    const value = der.subarray(offset + 2, offset + 2 + len);
    offset += 2 + len;
    return value;
  };
  const r = stripLeadingZero(readInt());
  const s = stripLeadingZero(readInt());
  const pad = (v: Uint8Array): Uint8Array => {
    const out = new Uint8Array(32);
    out.set(v.length > 32 ? v.slice(v.length - 32) : v, 32 - Math.min(v.length, 32));
    return out;
  };
  return encodeJose(pad(r), pad(s));
}

/**
 * Wrap two raw P-1363 ECDSA integers into the JOSE fixed-width form
 * (Bun's WebCrypto already signs in this shape — no DER involved).
 *
 * @param r - Left 32-byte half
 * @param s - Right 32-byte half
 */
export function rawToJose(r: Uint8Array, s: Uint8Array): string {
  return encodeJose(pad32(r), pad32(s));
}

function pad32(value: Uint8Array): Uint8Array {
  const trimmed = trimLeadingZeros(value);
  const out = new Uint8Array(32);
  out.set(trimmed.slice(0, 32), Math.max(32 - trimmed.length, 0));
  return out;
}

function trimLeadingZeros(value: Uint8Array): Uint8Array {
  let start = 0;
  while (start < value.length - 1 && value[start] === 0) start++;
  return value.subarray(start);
}

function encodeJose(r: Uint8Array, s: Uint8Array): string {
  const jose = new Uint8Array(64);
  jose.set(r, 0);
  jose.set(s, 32);
  let binary = "";
  for (const b of jose) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function stripLeadingZero(value: Uint8Array): Uint8Array {
  return value.length > 1 && value[0] === 0 ? value.subarray(1) : value;
}

/**
 * Fresh state/nonce pair for an OIDC start.
 */
export function mintOidcFlowSecrets(): { state: string; nonce: string } {
  return { state: generateState(), nonce: generateState() };
}

export type { OAuthDriverId };
