/**
 * API keys are first-class principals with attenuation.
 *
 * A key can never exceed the permissions of whoever created it.
 * The raw secret is returned exactly once on create / rotate.
 *
 * @see docs/spec/console.md §3.3 · §9.14
 */

import { assertAttenuated } from "./attenuation.ts";
import type { AuthPlane } from "./planes.ts";
import type { ApiKeyRow } from "./tables.ts";

/** Options when creating an API key. */
export interface CreateApiKeyOptions {
  readonly plane: AuthPlane;
  readonly name: string;
  readonly scopes: readonly string[];
  readonly creatorId: string;
  /** Creator's full scope set — attenuation ceiling. */
  readonly creatorScopes: ReadonlySet<string> | Iterable<string>;
  readonly expiresAt?: number | null;
  readonly rateLimit?: { max: number; per: string } | null;
  readonly ipAllowlist?: readonly string[];
  /** Injectable id / secret / hash (tests). */
  readonly id?: string;
  readonly secret?: string;
  readonly hash?: string;
  readonly now?: () => number;
}

/** Result of key creation — secret shown exactly once. */
export interface CreatedApiKey {
  readonly row: ApiKeyRow;
  /** Raw secret — shown exactly once. */
  readonly secret: string;
}

/** In-memory API key store. */
export interface ApiKeyStore {
  keys: Map<string, ApiKeyRow>;
}

/**
 * Create an empty API key store.
 */
export function createApiKeyStore(): ApiKeyStore {
  return { keys: new Map() };
}

/**
 * Hash an API key secret (SHA-256 hex).
 *
 * @param secret - Raw secret
 */
export async function hashApiKeySecret(secret: string): Promise<string> {
  const bytes = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Create an API key attenuated to the creator's scopes.
 *
 * @param store - Key store
 * @param options - Key fields + creator ceiling
 */
export async function createApiKey(
  store: ApiKeyStore,
  options: CreateApiKeyOptions,
): Promise<CreatedApiKey> {
  assertAttenuated(options.creatorScopes, options.scopes, "api key");

  const now = options.now ?? (() => Date.now());
  const id = options.id ?? crypto.randomUUID();
  const secret = options.secret ?? `oke_${id.replace(/-/g, "")}_${randomSecret()}`;
  const hash = options.hash ?? (await hashApiKeySecret(secret));
  const creatorScopes = [...options.creatorScopes];

  const row: ApiKeyRow = {
    id,
    plane: options.plane,
    hash,
    name: options.name,
    scopes: [...options.scopes],
    expiresAt: options.expiresAt ?? null,
    rateLimit: options.rateLimit ?? null,
    ipAllowlist: [...(options.ipAllowlist ?? [])],
    creatorId: options.creatorId,
    creatorScopes,
    createdAt: now(),
    lastUsedAt: null,
    revokedAt: null,
  };
  store.keys.set(id, row);
  return { row, secret };
}

/**
 * Resolve a key by raw secret; enforces expiry and revocation.
 *
 * @param store - Key store
 * @param secret - Raw secret
 * @param now - Clock
 */
export async function authenticateApiKey(
  store: ApiKeyStore,
  secret: string,
  now: () => number = () => Date.now(),
): Promise<ApiKeyRow | null> {
  const hash = await hashApiKeySecret(secret);
  for (const row of store.keys.values()) {
    if (row.hash !== hash) continue;
    if (row.revokedAt !== null) return null;
    if (row.expiresAt !== null && row.expiresAt <= now()) return null;
    row.lastUsedAt = now();
    return row;
  }
  return null;
}

/**
 * Revoke an API key — irreversible. The row remains for audit / hygiene.
 *
 * @param store - Key store
 * @param id - Key id
 * @param now - Clock
 */
export function revokeApiKey(
  store: ApiKeyStore,
  id: string,
  now: () => number = () => Date.now(),
): ApiKeyRow | null {
  const row = store.keys.get(id);
  if (!row || row.revokedAt !== null) return null;
  row.revokedAt = now();
  return row;
}

/**
 * Rotate an API key secret — new value shown exactly once; old hash dies.
 *
 * @param store - Key store
 * @param id - Key id
 * @param options - Optional secret override / clock
 */
export async function rotateApiKey(
  store: ApiKeyStore,
  id: string,
  options: {
    readonly secret?: string;
    readonly now?: () => number;
  } = {},
): Promise<CreatedApiKey | null> {
  const row = store.keys.get(id);
  if (!row || row.revokedAt !== null) return null;
  const secret = options.secret ?? `oke_${id.replace(/-/g, "")}_${randomSecret()}`;
  row.hash = await hashApiKeySecret(secret);
  return { row, secret };
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
