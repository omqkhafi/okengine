/**
 * CIMD (draft-ietf-oauth-client-id-metadata-document) client resolution —
 * fetch the metadata document AT the `client_id` URL, validate it, and cache.
 *
 * This is a cache, not a DCR registry (locked decision 1): clients register
 * nowhere; the document at their own HTTPS origin is the registration. The
 * `client_id` host must differ from the AS issuer host so a client cannot
 * self-host its metadata on the authorization server.
 */

import { OAuthError } from "./errors.ts";
import type { ClientCacheRow, CimdClientMetadata } from "./tables.ts";

/** Cache lifetime for fetched CIMD documents. */
export const CIMD_CACHE_TTL_MS = 5 * 60_000;

const REQUIRED_REDIRECT_SCHEMES = new Set(["https", "http"]);

/**
 * Validate a raw CIMD document against the URL it was fetched from.
 *
 * @param url - The `client_id` URL the document was served from
 * @param raw - Parsed JSON body
 */
export function parseCimdMetadata(url: string, raw: unknown): CimdClientMetadata {
  if (typeof raw !== "object" || raw === null) {
    throw new OAuthError("invalid_request", "client metadata document is not an object");
  }
  const doc = raw as Record<string, unknown>;
  const clientId = doc.client_id;
  if (typeof clientId !== "string" || clientId !== url) {
    throw new OAuthError("invalid_request", "metadata client_id must equal the document URL");
  }
  const redirectUris = doc.redirect_uris;
  if (
    !Array.isArray(redirectUris) ||
    redirectUris.length === 0 ||
    !redirectUris.every((u) => typeof u === "string" && isAcceptableRedirect(u))
  ) {
    throw new OAuthError(
      "invalid_request",
      "metadata redirect_uris must be absolute https/http URIs",
    );
  }
  return {
    client_id: clientId,
    ...(typeof doc.client_name === "string" ? { client_name: doc.client_name } : {}),
    redirect_uris: redirectUris as readonly string[],
    ...(Array.isArray(doc.grant_types)
      ? {
          grant_types: (doc.grant_types as unknown[]).filter(
            (g): g is string => typeof g === "string",
          ),
        }
      : {}),
    ...(Array.isArray(doc.response_types)
      ? {
          response_types: (doc.response_types as unknown[]).filter(
            (r): r is string => typeof r === "string",
          ),
        }
      : {}),
    ...(typeof doc.token_endpoint_auth_method === "string"
      ? { token_endpoint_auth_method: doc.token_endpoint_auth_method }
      : {}),
    ...(typeof doc.scope === "string" ? { scope: doc.scope } : {}),
    ...(typeof doc.jwks_uri === "string" ? { jwks_uri: doc.jwks_uri } : {}),
    ...(doc.jwks !== undefined ? { jwks: doc.jwks } : {}),
  };
}

/**
 * Resolve a `client_id` through the CIMD cache, refreshing when stale.
 *
 * @param cache - Cache map keyed by client id
 * @param clientId - Must be an https URL
 * @param now - Epoch-ms
 * @param fetchDoc - Document loader (injectable for tests)
 */
export async function resolveCimdClient(
  cache: Map<string, ClientCacheRow>,
  clientId: string,
  now: number,
  fetchDoc: (url: string) => Promise<unknown> = defaultFetch,
): Promise<ClientCacheRow> {
  let parsed: URL;
  try {
    parsed = new URL(clientId);
  } catch {
    throw new OAuthError("invalid_request", "client_id must be an https URL");
  }
  if (parsed.protocol !== "https:") {
    throw new OAuthError("invalid_request", "client_id must be an https URL");
  }
  const cached = cache.get(clientId);
  if (cached && cached.deniedAt === null && cached.fetchedAt + CIMD_CACHE_TTL_MS > now) {
    return cached;
  }
  let raw: unknown;
  try {
    raw = await fetchDoc(clientId);
  } catch {
    throw new OAuthError("invalid_request", "failed to fetch client metadata document");
  }
  const metadata = parseCimdMetadata(clientId, raw);
  const row: ClientCacheRow = { clientId, metadata, fetchedAt: now, deniedAt: null };
  cache.set(clientId, row);
  return row;
}

function isAcceptableRedirect(uri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  if (!REQUIRED_REDIRECT_SCHEMES.has(parsed.protocol.replace(":", ""))) return false;
  // http is only acceptable on loopback (native/dev clients).
  if (parsed.protocol === "http:" && !isLoopbackHost(parsed.hostname)) return false;
  return true;
}

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

async function defaultFetch(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`cimd fetch failed: ${response.status}`);
  return (await response.json()) as unknown;
}
