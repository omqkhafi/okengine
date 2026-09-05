/**
 * AS crypto — ES256 access tokens, JWKS publication, DPoP proof mint/verify.
 *
 * Hand-rolled on WebCrypto (no external OAuth/OIDC library). This module is
 * lazy-loaded: it is imported dynamically by the `mcpOauth` plugin and the
 * MCP RS verifier, so Store-only / non-MCP apps pay zero cost. Never import
 * statically from kernel entrypoints (`fx.ts`, `capability.ts`, cold paths).
 */

import { OAuthError } from "./errors.ts";
import type { SigningKeyRow } from "./tables.ts";
import { okid } from "../../okid.ts";

/** Default access-token TTL (10 minutes — short-lived per OAuth 2.1 posture). */
export const OAUTH_ACCESS_TTL_MS = 10 * 60_000;

/** Default authorization-code TTL (60 seconds, RFC 6749 §4.1.2). */
export const OAUTH_CODE_TTL_MS = 60_000;

/** Maximum accepted clock skew for DPoP `iat` validation (seconds). */
export const DPOP_MAX_CLOCK_SKEW_SECONDS = 30;

/** Acceptable DPoP `ath` hash mismatch / missing-proof errors surface as this code. */
export const DPOP_ALG = "ES256";

/** JOSE header for our ES256 access tokens. */
export interface JwtHeader {
  readonly alg: "ES256";
  readonly typ: "JWT";
  /** Key id — matches the active {@link SigningKeyRow.kid}. */
  readonly kid?: string;
}

/**
 * Access-token claims minted by the AS.
 *
 * Audience is the exact canonical RFC 8707 `resource` URI; `cnf.jkt`
 * sender-constrains the token to one DPoP key (RFC 9449).
 */
export interface OAuthAccessClaims {
  readonly iss: string;
  readonly sub: string;
  readonly client_id: string;
  /** Exact resource URI this token may be presented against. */
  readonly aud: string;
  readonly scope: string;
  readonly iat: number;
  readonly exp: number;
  readonly jti: string;
  readonly cnf?: { readonly jkt: string };
}

/** One DPoP proof-JWT claims set (RFC 9449 §4.2). */
export interface DpopClaims {
  readonly jti: string;
  readonly htm: string;
  readonly htu: string;
  readonly iat: number;
  /** Access-token `ath` claim — SHA-256 of the presented token (b64url). */
  readonly ath?: string;
}

/** In-memory signing-key store (persisted shape mirrors {@link SigningKeyRow}). */
export class AsKeyStore {
  private readonly keys = new Map<string, SigningKeyRow>();

  /**
   * Add a key row (tests / hydration).
   *
   * @param row - Key row
   */
  put(row: SigningKeyRow): void {
    this.keys.set(row.kid, row);
    if (row.active) {
      for (const [kid, other] of this.keys) {
        if (kid !== row.kid && other.active) {
          this.keys.set(kid, { ...other, active: false, rotatedAt: Date.now() });
        }
      }
    }
  }

  /** The currently active signing key (generates + registers one when absent). */
  async active(): Promise<SigningKeyRow> {
    for (const key of this.keys.values()) {
      if (key.active) return key;
    }
    return this.generate();
  }

  /**
   * Generate an ES256 keypair and register it as active (rotation: prior
   * keys stay published so outstanding tokens verify during overlap).
   */
  async generate(): Promise<SigningKeyRow> {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    const pub = await exportPublicJwk(pair.publicKey);
    const kid = await jwkThumbprint(pub);
    const row: SigningKeyRow = {
      kid,
      alg: "ES256",
      publicJwk: pub,
      privateKey: pair.privateKey,
      active: true,
      createdAt: Date.now(),
      rotatedAt: null,
    };
    this.put(row);
    return row;
  }

  /** Public JWK set for `GET /oauth/jwks` — every non-rotated-out key. */
  jwks(): { readonly keys: readonly Record<string, string>[] } {
    return {
      keys: [...this.keys.values()].map((k) => ({ ...k.publicJwk, kid: k.kid, alg: k.alg })),
    };
  }

  /** Look up a published key by `kid`. */
  byKid(kid: string): SigningKeyRow | undefined {
    return this.keys.get(kid);
  }
}

/**
 * Create an empty key store.
 */
export function createAsKeyStore(): AsKeyStore {
  return new AsKeyStore();
}

/**
 * Sign claims as an ES256 JWT under the active key.
 *
 * @param keys - Key store
 * @param claims - Payload
 */
export async function signAccessToken(
  keys: AsKeyStore,
  claims: OAuthAccessClaims,
): Promise<string> {
  const key = await keys.active();
  const header: JwtHeader = { alg: "ES256", typ: "JWT", kid: key.kid };
  const data = `${b64urlJson(header)}.${b64urlJson(claims)}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    key.privateKey,
    new TextEncoder().encode(data),
  );
  return `${data}.${b64urlBytes(new Uint8Array(signature))}`;
}

/**
 * Verify a signed JWT's ES256 signature and decode its payload.
 * Expiry / audience checks belong to callers.
 *
 * @param keys - Key store
 * @param token - Compact JWS
 */
export async function verifySignedJwt<T>(keys: AsKeyStore, token: string): Promise<T> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new OAuthError("invalid_token", "malformed token");
  const [headerPart, payloadPart, sigPart] = parts as [string, string, string];
  let header: JwtHeader;
  try {
    header = JSON.parse(b64urlDecodeText(headerPart)) as JwtHeader;
  } catch {
    throw new OAuthError("invalid_token", "malformed token header");
  }
  if (header.alg !== "ES256") throw new OAuthError("invalid_token", "unsupported alg");
  const key = header.kid !== undefined ? keys.byKid(header.kid) : await keys.active();
  if (!key) throw new OAuthError("invalid_token", "unknown signing key");
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    await importPublicJwk(key.publicJwk),
    b64urlDecodeBytes(sigPart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`) as Uint8Array<ArrayBuffer>,
  );
  if (!ok) throw new OAuthError("invalid_token", "invalid token signature");
  try {
    return JSON.parse(b64urlDecodeText(payloadPart)) as T;
  } catch {
    throw new OAuthError("invalid_token", "malformed token payload");
  }
}

/**
 * Generate a fresh DPoP signer (client side / tests).
 *
 * @returns P-256 public JWK plus a `prove()` closure over the private key
 */
export async function createDpopSigner(): Promise<{
  readonly publicJwk: Record<string, string>;
  prove(input: {
    htm: string;
    htu: string;
    now?: number;
    accessToken?: string;
    nonce?: string;
  }): Promise<string>;
}> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const publicJwk = dpopPublicJwk(await exportPublicJwk(pair.publicKey));
  return {
    publicJwk,
    async prove({ htm, htu, now = Date.now(), accessToken, nonce }) {
      const claims: Record<string, unknown> = {
        jti: okid(),
        htm,
        htu: normalizeHtu(htu),
        iat: Math.floor(now / 1000),
        ...(accessToken !== undefined ? { ath: await sha256B64url(accessToken) } : {}),
        ...(nonce !== undefined ? { nonce } : {}),
      };
      const header = {
        alg: DPOP_ALG,
        typ: "dpop+jwt",
        jwk: stripRfc7517Extras(publicJwk),
      };
      const data = `${b64urlJson(header)}.${b64urlJson(claims)}`;
      const sig = await crypto.subtle.sign(
        { name: "ECDSA", hash: { name: "SHA-256" } },
        pair.privateKey,
        new TextEncoder().encode(data),
      );
      return `${data}.${b64urlBytes(new Uint8Array(sig))}`;
    },
  };
}

/** Decoded DPoP proof parts. */
export interface DecodedDpopProof {
  readonly header: {
    readonly alg: string;
    readonly typ: string;
    readonly jwk?: Record<string, string>;
  };
  readonly claims: DpopClaims;
}

/**
 * Decode a DPoP proof without verifying (header JWK needed before lookup).
 *
 * @param proof - Compact JWS
 */
export function decodeDpopProof(proof: string): DecodedDpopProof {
  const parts = proof.split(".");
  if (parts.length !== 3) throw new OAuthError("invalid_request", "malformed DPoP proof");
  try {
    const header = JSON.parse(b64urlDecodeText(parts[0] ?? "")) as DecodedDpopProof["header"];
    const claims = JSON.parse(b64urlDecodeText(parts[1] ?? "")) as DpopClaims;
    return { header, claims };
  } catch {
    throw new OAuthError("invalid_request", "malformed DPoP proof");
  }
}

/**
 * Verify a DPoP proof-JWT end to end (RFC 9449 §4.2):
 * header JWK sanity, ES256 signature, required claims, `iat` window,
 * method/URI binding, and optional `ath` binding to the presented token.
 *
 * @param proof - Compact proof-JWT
 * @param input - Expected HTTP method / target URI, clock, token for `ath`
 */
export async function verifyDpopProof(
  proof: string,
  input: {
    htm: string;
    htu: string;
    now?: number;
    accessToken?: string;
  },
): Promise<Record<string, string>> {
  const { header, claims } = decodeDpopProof(proof);
  const jwk = header.jwk;
  if (!jwk || !jwk.crv || !jwk.x || !jwk.y || jwk.d !== undefined) {
    throw new OAuthError("invalid_request", "DPoP proof jwk must be a public EC key");
  }
  if (jwk.kty !== undefined && jwk.kty !== "EC") {
    throw new OAuthError("invalid_request", "DPoP proof jwk must use kty=EC");
  }
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  if (
    typeof claims.iat !== "number" ||
    Math.abs(nowSeconds - claims.iat) > DPOP_MAX_CLOCK_SKEW_SECONDS
  ) {
    throw new OAuthError("invalid_request", "DPoP proof iat outside acceptance window");
  }
  if (claims.htm !== input.htm) {
    throw new OAuthError("invalid_request", "DPoP proof htm mismatch");
  }
  if (normalizeHtu(claims.htu) !== normalizeHtu(input.htu)) {
    throw new OAuthError("invalid_request", "DPoP proof htu mismatch");
  }
  const verified = await crypto.subtle.verify(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    await importPublicJwk(jwk),
    b64urlDecodeBytes(proof.split(".")[2] ?? ""),
    new TextEncoder().encode(
      `${proof.split(".")[0]}.${proof.split(".")[1]}`,
    ) as Uint8Array<ArrayBuffer>,
  );
  if (!verified) throw new OAuthError("invalid_request", "invalid DPoP proof signature");
  if (input.accessToken !== undefined) {
    const expected = await sha256B64url(input.accessToken);
    if (claims.ath !== expected) {
      throw new OAuthError("insufficient_scope", "DPoP ath mismatch");
    }
  }
  return jwk;
}

/**
 * Compute the RFC 7638 JWK thumbprint (`jkt`) used in `cnf.jkt`.
 *
 * @param jwk - Public EC JWK (extra members ignored)
 */
export async function jwkThumbprint(jwk: Readonly<Record<string, string>>): Promise<string> {
  return sha256B64url(JSON.stringify(stripRfc7517Extras({ ...jwk })));
}

async function importPublicJwk(jwk: Readonly<Record<string, string>>): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    { ...stripRfc7517Extras({ ...jwk }), key_ops: ["verify"] },
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"],
  );
}

async function exportPublicJwk(key: CryptoKey): Promise<Record<string, string>> {
  const exported = await crypto.subtle.exportKey("jwk", key);
  return { ...(exported as Record<string, string>) };
}

function dpopPublicJwk(jwk: Record<string, string>): Record<string, string> {
  return { kty: jwk.kty ?? "EC", crv: jwk.crv ?? "P-256", x: jwk.x ?? "", y: jwk.y ?? "" };
}

function stripRfc7517Extras(jwk: Readonly<Record<string, string>>): Record<string, string> {
  const { kty, crv, x, y } = jwk;
  return { kty: kty ?? "", crv: crv ?? "", x: x ?? "", y: y ?? "" };
}

/** RFC 9449 §4.4 htu normalization: lowercase scheme/host, drop query+fragment. */
function normalizeHtu(htu: string): string {
  let url: URL;
  try {
    url = new URL(htu);
  } catch {
    throw new OAuthError("invalid_request", "invalid htu");
  }
  url.hash = "";
  url.search = "";
  return `${url.protocol}//${url.host}${url.pathname}`.toLowerCase();
}

async function sha256B64url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return b64urlBytes(new Uint8Array(digest));
}

function b64urlJson(value: unknown): string {
  return b64urlBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function b64urlBytes(bytes: Uint8Array<ArrayBuffer>): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecodeBytes(s: string): Uint8Array<ArrayBuffer> {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const bin = atob(padded + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64urlDecodeText(s: string): string {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return atob(padded + pad);
}
