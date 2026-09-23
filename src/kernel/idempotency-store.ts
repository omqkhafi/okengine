/**
 * Idempotency records on the journal driver.
 *
 * A sibling of `oke_journal_runs`. Rows are not journal runs: boot orphan
 * scan would try to resume them, and `JournalStore.put` is not an atomic insert.
 *
 * @module
 */

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/** Default record lifetime. */
export const IDEMPOTENCY_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/** Default in-progress lease. Renew every third of this while `do` runs. */
export const IDEMPOTENCY_LEASE_MS = 30_000;

/** Scope of one idempotent call. */
export interface IdempotencyScope {
  readonly tenant: string;
  readonly principal: string;
  readonly flow: string;
  readonly key: string;
}

/** Buffered HTTP response kept until TTL. */
export interface StoredResponse {
  readonly status: number;
  readonly body: string;
  readonly contentType?: string;
  readonly location?: string;
}

/** One `oke_idempotency` row. */
export interface IdempotencyRow {
  tenant: string;
  principal: string;
  flow: string;
  key: string;
  fingerprint: string;
  status: "in_progress" | "completed";
  claimToken: string;
  leaseExpiresAt: number;
  runId?: string;
  responseStatus?: number;
  responseHeaders?: { readonly contentType?: string; readonly location?: string };
  responseBody?: string;
  createdAt: number;
  expiresAt: number;
}

/** Result of an atomic claim. */
export type ClaimResult =
  | { readonly kind: "claimed"; readonly row: IdempotencyRow }
  | { readonly kind: "reclaimed"; readonly row: IdempotencyRow }
  | { readonly kind: "replay"; readonly row: IdempotencyRow }
  | { readonly kind: "mismatch" }
  | { readonly kind: "in_progress"; readonly retryAfterSeconds: number };

/** Arguments for {@link IdempotencyStore.claim}. */
export interface ClaimInput {
  readonly scope: IdempotencyScope;
  readonly fingerprint: string;
  readonly claimToken: string;
  readonly now: number;
  readonly leaseMs: number;
  readonly ttlMs: number;
}

/**
 * Persistence for idempotency rows.
 *
 * `forfeit` drops the in-process holder and expires the lease without
 * deleting the row — the stand-in for a crashed process in tests.
 */
export interface IdempotencyStore {
  claim(input: ClaimInput): Promise<ClaimResult>;
  complete(
    scope: IdempotencyScope,
    token: string,
    response: StoredResponse,
    runId?: string,
  ): Promise<boolean>;
  remove(scope: IdempotencyScope, token: string): Promise<boolean>;
  renew(scope: IdempotencyScope, token: string, leaseExpiresAt: number): Promise<boolean>;
  attachRun(scope: IdempotencyScope, token: string, runId: string): Promise<boolean>;
  /**
   * Drop the in-process holder and rotate the token so a late renew or
   * complete from the crashed attempt cannot touch the row.
   */
  forfeit(scope: IdempotencyScope, token: string): Promise<boolean>;
  /** Load one row. Tests use this to forfeit a live claim. */
  read(scope: IdempotencyScope): Promise<IdempotencyRow | undefined>;
  purgeExpired(now: number): Promise<void>;
}

/** Minimal SQL surface the postgres journal client already exposes. */
export interface IdempotencySql {
  query(sql: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]>;
  exec(sql: string, params?: readonly unknown[]): Promise<{ changes: number }>;
}

/** Insert that loses the race returns zero changes. */
export const IDEM_INSERT_SQL = `INSERT INTO oke_idempotency (tenant, principal, flow, key, fingerprint, status, claim_token, lease_expires_at, run_id, response_status, response_headers, response_body, created_at, expires_at) VALUES (?, ?, ?, ?, ?, 'in_progress', ?, ?, NULL, NULL, NULL, NULL, ?, ?) ON CONFLICT (tenant, principal, flow, key) DO NOTHING RETURNING claim_token`;

/** Load the row after a lost insert. */
export const IDEM_SELECT_SQL = `SELECT * FROM oke_idempotency WHERE tenant=? AND principal=? AND flow=? AND key=?`;

/** Drop one expired row before a fresh claim. */
export const IDEM_DELETE_EXPIRED_ONE_SQL = `DELETE FROM oke_idempotency WHERE tenant=? AND principal=? AND flow=? AND key=? AND expires_at<=?`;

/** Sweep every expired row. */
export const IDEM_PURGE_SQL = `DELETE FROM oke_idempotency WHERE expires_at<=?`;

/** Compare-and-set a crashed holder's token. */
export const IDEM_RECLAIM_SQL = `UPDATE oke_idempotency SET claim_token=?, lease_expires_at=? WHERE tenant=? AND principal=? AND flow=? AND key=? AND claim_token=? AND status='in_progress' RETURNING claim_token`;

/** Store the response when this token still holds the row. */
export const IDEM_COMPLETE_SQL = `UPDATE oke_idempotency SET status='completed', response_status=?, response_headers=?, response_body=?, run_id=COALESCE(?, run_id) WHERE tenant=? AND principal=? AND flow=? AND key=? AND claim_token=? RETURNING claim_token`;

/** Delete a row this token still holds. */
export const IDEM_REMOVE_SQL = `DELETE FROM oke_idempotency WHERE tenant=? AND principal=? AND flow=? AND key=? AND claim_token=? RETURNING claim_token`;

/** Extend the lease when this token still holds the row. */
export const IDEM_RENEW_SQL = `UPDATE oke_idempotency SET lease_expires_at=? WHERE tenant=? AND principal=? AND flow=? AND key=? AND claim_token=? AND status='in_progress' RETURNING claim_token`;

/** Record the journal run id while this token holds the row. */
export const IDEM_ATTACH_SQL = `UPDATE oke_idempotency SET run_id=? WHERE tenant=? AND principal=? AND flow=? AND key=? AND claim_token=? RETURNING claim_token`;

/** Expire the lease. The in-process holder set is cleared by the caller. */
export const IDEM_FORFEIT_SQL = `UPDATE oke_idempotency SET claim_token=?, lease_expires_at=0 WHERE tenant=? AND principal=? AND flow=? AND key=? AND claim_token=? AND status='in_progress' RETURNING claim_token`;

const PURGE_INTERVAL_MS = 60_000;

/**
 * In-memory idempotency store. One mutex keeps same-process claims atomic.
 */
export function createMemoryIdempotencyStore(): IdempotencyStore {
  const rows = new Map<string, IdempotencyRow>();
  return createMapStore(rows, async () => undefined);
}

/**
 * File-backed idempotency store beside the journal file.
 *
 * @param path - JSON file path
 */
export function createFileIdempotencyStore(path: string): IdempotencyStore {
  let rows: Map<string, IdempotencyRow> | undefined;
  const load = async (): Promise<Map<string, IdempotencyRow>> => {
    if (rows) return rows;
    rows = new Map();
    const file = Bun.file(path);
    if (await file.exists()) {
      const raw = (await file.json()) as { rows?: IdempotencyRow[] };
      for (const row of raw.rows ?? []) rows.set(rowKey(row), { ...row });
    }
    return rows;
  };
  const flush = async (map: Map<string, IdempotencyRow>): Promise<void> => {
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, JSON.stringify({ rows: [...map.values()] }));
  };
  return createMapStoreAsync(load, flush);
}

/**
 * Postgres idempotency store on the journal connection.
 *
 * @param sql - Journal SQL client
 */
export function createPostgresIdempotencyStore(sql: IdempotencySql): IdempotencyStore {
  const held = new Set<string>();
  let lastPurge = 0;
  let tail: Promise<void> = Promise.resolve();

  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const scopeParams = (scope: IdempotencyScope): readonly string[] => [
    scope.tenant,
    scope.principal,
    scope.flow,
    scope.key,
  ];

  return {
    claim(input) {
      return exclusive(async () => {
        if (input.now - lastPurge >= PURGE_INTERVAL_MS) {
          lastPurge = input.now;
          await sql.exec(IDEM_PURGE_SQL, [input.now]);
        }
        await sql.exec(IDEM_DELETE_EXPIRED_ONE_SQL, [...scopeParams(input.scope), input.now]);
        const inserted = await sql.exec(IDEM_INSERT_SQL, insertParams(input));
        if (inserted.changes > 0) {
          held.add(input.claimToken);
          return { kind: "claimed" as const, row: freshRow(input) };
        }
        const found = await sql.query(IDEM_SELECT_SQL, scopeParams(input.scope));
        const existing = found[0] ? postgresRow(found[0]) : undefined;
        return applyDecision(sql, held, existing, input);
      });
    },
    complete(scope, token, response, runId) {
      return exclusive(async () => {
        const headers = JSON.stringify({
          ...(response.contentType !== undefined ? { contentType: response.contentType } : {}),
          ...(response.location !== undefined ? { location: response.location } : {}),
        });
        const result = await sql.exec(IDEM_COMPLETE_SQL, [
          response.status,
          headers,
          response.body,
          runId ?? null,
          ...scopeParams(scope),
          token,
        ]);
        if (result.changes > 0) held.delete(token);
        return result.changes > 0;
      });
    },
    remove(scope, token) {
      return exclusive(async () => {
        const result = await sql.exec(IDEM_REMOVE_SQL, [...scopeParams(scope), token]);
        if (result.changes > 0) held.delete(token);
        return result.changes > 0;
      });
    },
    renew(scope, token, leaseExpiresAt) {
      return exclusive(async () => {
        if (!held.has(token)) return false;
        const result = await sql.exec(IDEM_RENEW_SQL, [leaseExpiresAt, ...scopeParams(scope), token]);
        return result.changes > 0;
      });
    },
    attachRun(scope, token, runId) {
      return exclusive(async () => {
        const result = await sql.exec(IDEM_ATTACH_SQL, [runId, ...scopeParams(scope), token]);
        return result.changes > 0;
      });
    },
    forfeit(scope, token) {
      return exclusive(async () => {
        held.delete(token);
        const result = await sql.exec(IDEM_FORFEIT_SQL, [
          crypto.randomUUID(),
          ...scopeParams(scope),
          token,
        ]);
        return result.changes > 0;
      });
    },
    read(scope) {
      return exclusive(async () => {
        const found = await sql.query(IDEM_SELECT_SQL, scopeParams(scope));
        return found[0] ? postgresRow(found[0]) : undefined;
      });
    },
    purgeExpired(now) {
      return exclusive(async () => {
        lastPurge = now;
        await sql.exec(IDEM_PURGE_SQL, [now]);
      });
    },
  };
}

/**
 * Decide what a conflicting row means. Does not mutate.
 *
 * @param existing - Current row, if the key is present and unexpired
 * @param input - This attempt
 * @param held - Claim tokens this process is still inside `do` for
 */
export function decideClaim(
  existing: IdempotencyRow | undefined,
  input: ClaimInput,
  held: ReadonlySet<string>,
):
  | { readonly op: "insert" }
  | { readonly op: "mismatch" }
  | { readonly op: "replay"; readonly row: IdempotencyRow }
  | { readonly op: "busy"; readonly retryAfterSeconds: number }
  | { readonly op: "reclaim"; readonly row: IdempotencyRow } {
  if (existing === undefined || existing.expiresAt <= input.now) return { op: "insert" };
  if (existing.fingerprint !== input.fingerprint) return { op: "mismatch" };
  if (existing.status === "completed") return { op: "replay", row: existing };
  if (existing.leaseExpiresAt > input.now || held.has(existing.claimToken)) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.leaseExpiresAt - input.now) / 1000));
    return { op: "busy", retryAfterSeconds };
  }
  return { op: "reclaim", row: existing };
}

function createMapStore(
  rows: Map<string, IdempotencyRow>,
  flush: (map: Map<string, IdempotencyRow>) => Promise<void>,
): IdempotencyStore {
  return createMapStoreAsync(async () => rows, flush);
}

function createMapStoreAsync(
  load: () => Promise<Map<string, IdempotencyRow>>,
  flush: (map: Map<string, IdempotencyRow>) => Promise<void>,
): IdempotencyStore {
  const held = new Set<string>();
  let lastPurge = 0;
  let tail: Promise<void> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  return {
    claim(input) {
      return exclusive(async () => {
        const map = await load();
        if (input.now - lastPurge >= PURGE_INTERVAL_MS) {
          lastPurge = input.now;
          purgeMap(map, input.now);
        }
        const id = scopeKey(input.scope);
        const current = map.get(id);
        if (current !== undefined && current.expiresAt <= input.now) map.delete(id);
        const existing = map.get(id);
        const decision = decideClaim(existing, input, held);
        if (decision.op === "insert") {
          const row = freshRow(input);
          map.set(id, row);
          held.add(input.claimToken);
          await flush(map);
          return { kind: "claimed" as const, row: cloneRow(row) };
        }
        if (decision.op === "mismatch") return { kind: "mismatch" as const };
        if (decision.op === "replay") return { kind: "replay" as const, row: cloneRow(decision.row) };
        if (decision.op === "busy") {
          return { kind: "in_progress" as const, retryAfterSeconds: decision.retryAfterSeconds };
        }
        const row = decision.row;
        held.delete(row.claimToken);
        row.claimToken = input.claimToken;
        row.leaseExpiresAt = input.now + input.leaseMs;
        held.add(input.claimToken);
        await flush(map);
        return { kind: "reclaimed" as const, row: cloneRow(row) };
      });
    },
    complete(scope, token, response, runId) {
      return exclusive(async () => {
        const map = await load();
        const row = map.get(scopeKey(scope));
        if (row === undefined || row.claimToken !== token) return false;
        row.status = "completed";
        row.responseStatus = response.status;
        row.responseBody = response.body;
        row.responseHeaders = {
          ...(response.contentType !== undefined ? { contentType: response.contentType } : {}),
          ...(response.location !== undefined ? { location: response.location } : {}),
        };
        if (runId !== undefined) row.runId = runId;
        held.delete(token);
        await flush(map);
        return true;
      });
    },
    remove(scope, token) {
      return exclusive(async () => {
        const map = await load();
        const id = scopeKey(scope);
        const row = map.get(id);
        if (row === undefined || row.claimToken !== token) return false;
        map.delete(id);
        held.delete(token);
        await flush(map);
        return true;
      });
    },
    renew(scope, token, leaseExpiresAt) {
      return exclusive(async () => {
        if (!held.has(token)) return false;
        const map = await load();
        const row = map.get(scopeKey(scope));
        if (row === undefined || row.claimToken !== token || row.status !== "in_progress") return false;
        row.leaseExpiresAt = leaseExpiresAt;
        await flush(map);
        return true;
      });
    },
    attachRun(scope, token, runId) {
      return exclusive(async () => {
        const map = await load();
        const row = map.get(scopeKey(scope));
        if (row === undefined || row.claimToken !== token) return false;
        row.runId = runId;
        await flush(map);
        return true;
      });
    },
    forfeit(scope, token) {
      return exclusive(async () => {
        const map = await load();
        const row = map.get(scopeKey(scope));
        held.delete(token);
        if (row === undefined || row.claimToken !== token || row.status !== "in_progress") return false;
        row.claimToken = crypto.randomUUID();
        row.leaseExpiresAt = 0;
        await flush(map);
        return true;
      });
    },
    read(scope) {
      return exclusive(async () => {
        const map = await load();
        const row = map.get(scopeKey(scope));
        return row === undefined ? undefined : cloneRow(row);
      });
    },
    purgeExpired(now) {
      return exclusive(async () => {
        const map = await load();
        lastPurge = now;
        purgeMap(map, now);
        await flush(map);
      });
    },
  };
}

async function applyDecision(
  sql: IdempotencySql,
  held: Set<string>,
  existing: IdempotencyRow | undefined,
  input: ClaimInput,
): Promise<ClaimResult> {
  const decision = decideClaim(existing, input, held);
  if (decision.op === "insert") {
    const again = await sql.exec(IDEM_INSERT_SQL, insertParams(input));
    if (again.changes > 0) {
      held.add(input.claimToken);
      return { kind: "claimed", row: freshRow(input) };
    }
    return { kind: "in_progress", retryAfterSeconds: 1 };
  }
  if (decision.op === "mismatch") return { kind: "mismatch" };
  if (decision.op === "replay") return { kind: "replay", row: decision.row };
  if (decision.op === "busy") {
    return { kind: "in_progress", retryAfterSeconds: decision.retryAfterSeconds };
  }
  const updated = await sql.exec(IDEM_RECLAIM_SQL, [
    input.claimToken,
    input.now + input.leaseMs,
    input.scope.tenant,
    input.scope.principal,
    input.scope.flow,
    input.scope.key,
    decision.row.claimToken,
  ]);
  if (updated.changes < 1) return { kind: "in_progress", retryAfterSeconds: 1 };
  held.delete(decision.row.claimToken);
  held.add(input.claimToken);
  return {
    kind: "reclaimed",
    row: {
      ...decision.row,
      claimToken: input.claimToken,
      leaseExpiresAt: input.now + input.leaseMs,
    },
  };
}

function freshRow(input: ClaimInput): IdempotencyRow {
  return {
    tenant: input.scope.tenant,
    principal: input.scope.principal,
    flow: input.scope.flow,
    key: input.scope.key,
    fingerprint: input.fingerprint,
    status: "in_progress",
    claimToken: input.claimToken,
    leaseExpiresAt: input.now + input.leaseMs,
    createdAt: input.now,
    expiresAt: input.now + input.ttlMs,
  };
}

function insertParams(input: ClaimInput): readonly unknown[] {
  const row = freshRow(input);
  return [
    row.tenant,
    row.principal,
    row.flow,
    row.key,
    row.fingerprint,
    row.claimToken,
    row.leaseExpiresAt,
    row.createdAt,
    row.expiresAt,
  ];
}

function postgresRow(raw: Record<string, unknown>): IdempotencyRow {
  const headers = parseHeaders(raw.response_headers);
  return {
    tenant: String(raw.tenant ?? ""),
    principal: String(raw.principal ?? ""),
    flow: String(raw.flow ?? ""),
    key: String(raw.key ?? ""),
    fingerprint: String(raw.fingerprint ?? ""),
    status: raw.status === "completed" ? "completed" : "in_progress",
    claimToken: String(raw.claim_token ?? ""),
    leaseExpiresAt: Number(raw.lease_expires_at ?? 0),
    ...(raw.run_id !== null && raw.run_id !== undefined ? { runId: String(raw.run_id) } : {}),
    ...(raw.response_status !== null && raw.response_status !== undefined
      ? { responseStatus: Number(raw.response_status) }
      : {}),
    ...(headers !== undefined ? { responseHeaders: headers } : {}),
    ...(raw.response_body !== null && raw.response_body !== undefined
      ? { responseBody: String(raw.response_body) }
      : {}),
    createdAt: Number(raw.created_at ?? 0),
    expiresAt: Number(raw.expires_at ?? 0),
  };
}

function parseHeaders(
  value: unknown,
): { readonly contentType?: string; readonly location?: string } | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  try {
    const parsed = JSON.parse(value) as { contentType?: unknown; location?: unknown };
    return {
      ...(typeof parsed.contentType === "string" ? { contentType: parsed.contentType } : {}),
      ...(typeof parsed.location === "string" ? { location: parsed.location } : {}),
    };
  } catch {
    return undefined;
  }
}

function scopeKey(scope: IdempotencyScope): string {
  return `${scope.tenant}\0${scope.principal}\0${scope.flow}\0${scope.key}`;
}

function rowKey(row: IdempotencyScope): string {
  return scopeKey(row);
}

function cloneRow(row: IdempotencyRow): IdempotencyRow {
  return { ...row, ...(row.responseHeaders ? { responseHeaders: { ...row.responseHeaders } } : {}) };
}

function purgeMap(map: Map<string, IdempotencyRow>, now: number): void {
  for (const [id, row] of map) {
    if (row.expiresAt <= now) map.delete(id);
  }
}
