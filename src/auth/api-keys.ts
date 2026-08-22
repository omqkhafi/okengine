/**
 * API keys are first-class principals with attenuation.
 *
 * A key can never exceed the permissions of whoever created it.
 * The raw secret is returned exactly once on create / rotate.
 * Hash is HMAC-SHA-256 with the auth pepper (gate.auth.secret).
 *
 * @see docs/spec/console.md §3.3 · §9.14
 */

import { lookup as dnsLookup } from "node:dns/promises";
import { parseDurationMs } from "../elements/clock/duration.ts";
import { assertAttenuated } from "./attenuation.ts";
import type { AuthPlane } from "./planes.ts";
import type { ApiKeyRow } from "./tables.ts";

/** Capability / Manifest resource for `fx.auth` key methods. */
export const AUTH_API_KEYS_RESOURCE = "auth:api-keys";

/** Default HMAC pepper when no `gate.auth.secret` is bound (tests). */
const DEFAULT_PEPPER = "oke.api-key";

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
  /** Optional tenant claim copied onto the key principal. */
  readonly tenantId?: string | null;
  /** Injectable id / secret / hash (tests). */
  readonly id?: string;
  readonly secret?: string;
  readonly hash?: string;
  readonly now?: () => number;
  /** HMAC pepper override (defaults to store pepper). */
  readonly pepper?: string;
}

/** Patch for {@link updateApiKey}. */
export interface UpdateApiKeyOptions {
  readonly name?: string;
  readonly scopes?: readonly string[];
  readonly expiresAt?: number | null;
  readonly rateLimit?: { max: number; per: string } | null;
  readonly ipAllowlist?: readonly string[];
  /** Ceiling for scope changes (stored creatorScopes ∩ live scopes). */
  readonly ceiling: ReadonlySet<string> | Iterable<string>;
}

/** Result of key creation — secret shown exactly once. */
export interface CreatedApiKey {
  readonly row: ApiKeyRow;
  /** Raw secret — shown exactly once. */
  readonly secret: string;
}

/** Public key row returned by `fx.auth.listApiKeys` (never includes hash). */
export interface ApiKeyPublicRow {
  readonly id: string;
  readonly name: string;
  readonly plane: AuthPlane;
  readonly scopes: readonly string[];
  readonly createdAt: number;
  readonly lastUsedAt: number | null;
  readonly expiresAt: number | null;
  readonly revokedAt: number | null;
  readonly rateLimit: { max: number; per: string } | null;
  readonly ipAllowlist: readonly string[];
}

/**
 * API key store — in-memory Map, optionally HMAC-peppered.
 * SQL persist is a write-through adapter bound at boot.
 */
export interface ApiKeyStore {
  keys: Map<string, ApiKeyRow>;
  /** HMAC pepper (`gate.auth.secret`). */
  pepper?: string;
  /** Optional write-through persist (SQL). */
  persist?: (row: ApiKeyRow) => void | Promise<void>;
  /** Sliding-window hits for per-key rateLimit (subject = key id). */
  rateHits?: Map<string, number[]>;
}

/** Options for {@link createApiKeyStore}. */
export interface CreateApiKeyStoreOptions {
  readonly pepper?: string;
  readonly persist?: (row: ApiKeyRow) => void | Promise<void>;
}

/**
 * Create an empty API key store.
 *
 * @param options - Optional HMAC pepper / persist hook
 */
export function createApiKeyStore(options: CreateApiKeyStoreOptions = {}): ApiKeyStore {
  return {
    keys: new Map(),
    ...(options.pepper !== undefined ? { pepper: options.pepper } : {}),
    ...(options.persist !== undefined ? { persist: options.persist } : {}),
  };
}

/**
 * HMAC-SHA-256 hex of an API key secret.
 *
 * @param secret - Raw secret
 * @param pepper - HMAC key (`gate.auth.secret`); defaults to a test pepper
 */
export async function hashApiKeySecret(
  secret: string,
  pepper: string = DEFAULT_PEPPER,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(secret));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function persistRow(store: ApiKeyStore, row: ApiKeyRow): Promise<void> {
  await store.persist?.(row);
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
  const pepper = options.pepper ?? store.pepper ?? DEFAULT_PEPPER;
  const hash = options.hash ?? (await hashApiKeySecret(secret, pepper));
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
    ...(options.tenantId !== undefined ? { tenantId: options.tenantId } : {}),
  };
  store.keys.set(id, row);
  await persistRow(store, row);
  return { row, secret };
}

/** Resolve a stored hostname to addresses (injected in tests). */
export type AllowlistLookup = (host: string) => Promise<readonly string[]>;

/** Options for {@link authenticateApiKey}. */
export interface AuthenticateApiKeyOptions {
  readonly now?: () => number;
  /** Client IP for allowlist enforcement. */
  readonly ip?: string;
  /** Hostname → A/AAAA (defaults to system DNS). */
  readonly lookup?: AllowlistLookup;
}

/**
 * Resolve a key by raw secret; enforces expiry, revocation, and allowlist.
 *
 * @param store - Key store
 * @param secret - Raw secret
 * @param nowOrOptions - Clock, or clock + client IP
 */
export async function authenticateApiKey(
  store: ApiKeyStore,
  secret: string,
  nowOrOptions: (() => number) | AuthenticateApiKeyOptions = () => Date.now(),
): Promise<ApiKeyRow | null> {
  const options: AuthenticateApiKeyOptions =
    typeof nowOrOptions === "function" ? { now: nowOrOptions } : nowOrOptions;
  const now = options.now ?? (() => Date.now());
  const pepper = store.pepper ?? DEFAULT_PEPPER;
  const hash = await hashApiKeySecret(secret, pepper);
  for (const row of store.keys.values()) {
    if (row.hash !== hash) continue;
    if (row.revokedAt !== null) return null;
    if (row.expiresAt !== null && row.expiresAt <= now()) return null;
    if (row.ipAllowlist.length > 0) {
      const allowed = await allowlistAllowsIp(row.ipAllowlist, options.ip, options.lookup);
      if (!allowed) return null;
    }
    if (row.rateLimit && !takeKeyRate(store, row.id, row.rateLimit, now())) return null;
    row.lastUsedAt = now();
    await persistRow(store, row);
    return row;
  }
  return null;
}

/**
 * List keys created by `creatorId` (includes revoked rows for audit).
 *
 * @param store - Key store
 * @param creatorId - Issuer id
 */
export function listApiKeys(store: ApiKeyStore, creatorId: string): ApiKeyRow[] {
  return [...store.keys.values()]
    .filter((row) => row.creatorId === creatorId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Load one key by id.
 *
 * @param store - Key store
 * @param id - Key id
 */
export function getApiKey(store: ApiKeyStore, id: string): ApiKeyRow | undefined {
  return store.keys.get(id);
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
  void persistRow(store, row);
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
    readonly pepper?: string;
  } = {},
): Promise<CreatedApiKey | null> {
  const row = store.keys.get(id);
  if (!row || row.revokedAt !== null) return null;
  const secret = options.secret ?? `oke_${id.replace(/-/g, "")}_${randomSecret()}`;
  const pepper = options.pepper ?? store.pepper ?? DEFAULT_PEPPER;
  row.hash = await hashApiKeySecret(secret, pepper);
  await persistRow(store, row);
  return { row, secret };
}

/**
 * Update key metadata. Scope changes re-run {@link assertAttenuated}.
 *
 * @param store - Key store
 * @param id - Key id
 * @param options - Patch + attenuation ceiling
 */
export function updateApiKey(
  store: ApiKeyStore,
  id: string,
  options: UpdateApiKeyOptions,
): ApiKeyRow | null {
  const row = store.keys.get(id);
  if (!row || row.revokedAt !== null) return null;
  if (options.scopes !== undefined) {
    assertAttenuated(options.ceiling, options.scopes, "api key");
    row.scopes = [...options.scopes];
  }
  if (options.name !== undefined) row.name = options.name;
  if (options.expiresAt !== undefined) row.expiresAt = options.expiresAt;
  if (options.rateLimit !== undefined) row.rateLimit = options.rateLimit;
  if (options.ipAllowlist !== undefined) row.ipAllowlist = [...options.ipAllowlist];
  void persistRow(store, row);
  return row;
}

/**
 * Public projection of a key row (no hash / creatorScopes).
 *
 * @param row - Stored row
 */
export function toApiKeyPublicRow(row: ApiKeyRow): ApiKeyPublicRow {
  return {
    id: row.id,
    name: row.name,
    plane: row.plane,
    scopes: [...row.scopes],
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    rateLimit: row.rateLimit,
    ipAllowlist: [...row.ipAllowlist],
  };
}

/**
 * Whether the client IP matches an allowlist entry.
 * Literals compare exactly. Hostnames resolve at verify time (fail closed).
 *
 * @param entries - IPs and/or hostnames
 * @param ip - Client IP
 * @param lookup - Hostname resolver
 */
export async function allowlistAllowsIp(
  entries: readonly string[],
  ip: string | undefined,
  lookup: AllowlistLookup = lookupAllowlistHost,
): Promise<boolean> {
  if (entries.length === 0) return true;
  if (ip === undefined) return false;
  const client = ip.trim().toLowerCase();
  for (const raw of entries) {
    const entry = normalizeAllowlistEntry(raw);
    if (entry.length === 0) continue;
    if (isIpLiteral(entry)) {
      if (entry === client) return true;
      continue;
    }
    try {
      const addrs = await lookup(entry);
      if (addrs.some((addr) => addr.trim().toLowerCase() === client)) return true;
    } catch {
      // This host fails closed; other entries may still match.
    }
  }
  return false;
}

function normalizeAllowlistEntry(raw: string): string {
  let entry = raw.trim().toLowerCase();
  entry = entry.replace(/^https?:\/\//, "");
  const slash = entry.indexOf("/");
  if (slash >= 0) entry = entry.slice(0, slash);
  if (entry.endsWith(".")) entry = entry.slice(0, -1);
  return entry;
}

function isIpLiteral(entry: string): boolean {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(entry)) {
    return entry.split(".").every((octet) => Number(octet) <= 255);
  }
  return entry.includes(":") && /^[0-9a-f:.]+$/.test(entry);
}

async function lookupAllowlistHost(host: string): Promise<readonly string[]> {
  const rows = await dnsLookup(host, { all: true, verbatim: true });
  return rows.map((row) => row.address);
}

/**
 * Client IP from X-Forwarded-For (right-most trusted hop) or X-Real-IP.
 *
 * @param request - Incoming request
 * @param trustedProxyDepth - Hops from the right (default 1)
 */
export function clientIpFromRequest(request: Request, trustedProxyDepth = 1): string | undefined {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff
      .split(",")
      .map((h) => h.trim())
      .filter((h) => h.length > 0);
    const index = hops.length - trustedProxyDepth;
    if (index >= 0) return hops[index];
  }
  return request.headers.get("x-real-ip")?.trim() || undefined;
}

function takeKeyRate(
  store: ApiKeyStore,
  keyId: string,
  limit: { max: number; per: string },
  nowMs: number,
): boolean {
  const windowMs = parseDurationMs(limit.per);
  const hits = store.rateHits ?? (store.rateHits = new Map<string, number[]>());
  const prev = hits.get(keyId) ?? [];
  const kept = prev.filter((t) => nowMs - t < windowMs);
  if (kept.length >= limit.max) {
    hits.set(keyId, kept);
    return false;
  }
  kept.push(nowMs);
  hits.set(keyId, kept);
  return true;
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
