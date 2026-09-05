/**
 * Authorization Server store bundle factory — in-memory rows mirroring the
 * declared `oke_oauth_*` tables (same pattern as `SessionStore`).
 */

import { createAsKeyStore } from "./crypto.ts";
import type {
  AccessTokenRow,
  AsRefreshTokenRow,
  AuthCodeRow,
  ClientCacheRow,
  ConsentRow,
} from "./tables.ts";
import { okid } from "../../okid.ts";

/**
 * Create an empty AS store bundle.
 */
export function createAsStores(): {
  keys: ReturnType<typeof createAsKeyStore>;
  authCodes: Map<string, AuthCodeRow>;
  accessTokens: Map<string, AccessTokenRow>;
  refreshTokens: Map<string, AsRefreshTokenRow>;
  consents: Map<string, ConsentRow>;
  clientCache: Map<string, ClientCacheRow>;
  pending: Map<
    string,
    {
      id: string;
      userId: string;
      clientId: string;
      clientName: string | null;
      redirectUri: string;
      resource: string;
      scope: readonly string[];
      codeChallenge: string;
      state: string | undefined;
      expiresAt: number;
    }
  >;
} {
  return {
    keys: createAsKeyStore(),
    authCodes: new Map(),
    accessTokens: new Map(),
    refreshTokens: new Map(),
    consents: new Map(),
    clientCache: new Map(),
    pending: new Map(),
  };
}

/** SHA-256 hex of a raw secret (codes / refresh tokens are never stored raw). */
export async function hashSecret(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Cryptographically random id (no dashes), same hygiene as session ids. */
export function cryptoId(): string {
  return okid();
}
