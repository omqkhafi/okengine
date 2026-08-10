/**
 * In-memory Vault SQL fake for logic-only unit tests.
 *
 * Covers the statement catalog the builtin adapter + audit writer emit for
 * init / status / seal / unseal / set / verifyAudit. Not a general SQL
 * engine — dialect / bytea / DISTINCT ON proof stays on real PGlite in
 * `builtin-adapter.test.ts`.
 */

import type { SqlConnection, SqlRow } from "../../drivers/types.ts";

/** One row in an in-memory table. */
type Row = Record<string, unknown>;

/**
 * Create an in-process {@link SqlConnection} that speaks the Vault SQL
 * surface (Postgres `$n` placeholders, `bytea` as `Uint8Array`, auto `seq`).
 *
 * Pair with {@link import("./builtin-adapter.ts").sqlConnectionAsExec} when
 * the adapter needs a {@link import("./storage.ts").SqlExec}.
 *
 * @returns Fresh isolated connection (empty vault tables)
 */
export function createMemoryVaultSql(): SqlConnection {
  const secrets: Row[] = [];
  const keys: Row[] = [];
  const audit: Row[] = [];
  const master: Row[] = [];
  let status: Row = defaultStatus();
  let auditSeq = 0;

  async function query(sql: string, params: readonly unknown[] = []): Promise<SqlRow[]> {
    const text = normalize(sql);
    const p = [...params];

    if (isDdl(text) || text.startsWith("create index")) {
      return [];
    }

    if (text.startsWith("insert into oke_vault_status") && text.includes("on conflict")) {
      // Singleton already seeded in {@link defaultStatus}.
      return [];
    }

    if (text.startsWith("select sealed, initialized, master_key_present")) {
      return [{ ...status }];
    }

    if (
      text.startsWith("select key_hash, kek_version from oke_vault_master") &&
      text.includes("order by created_at asc")
    ) {
      const sorted = [...master].sort((a, b) => toTime(a.created_at) - toTime(b.created_at));
      const first = sorted[0];
      return first ? [{ key_hash: first.key_hash, kek_version: first.kek_version }] : [];
    }

    if (text.startsWith("select count(distinct path) as count from oke_vault_secrets")) {
      const live = secrets.filter((r) => r.deleted_at == null);
      return [{ count: new Set(live.map((r) => r.path)).size }];
    }

    if (text.startsWith("select row_hash from oke_vault_audit order by seq desc limit 1")) {
      const last = [...audit].sort((a, b) => Number(b.seq) - Number(a.seq))[0];
      return last ? [{ row_hash: last.row_hash }] : [];
    }

    if (
      text.startsWith("select id, action, path, actor_type") &&
      text.includes("from oke_vault_audit") &&
      text.includes("order by seq asc")
    ) {
      return [...audit].sort((a, b) => Number(a.seq) - Number(b.seq)).map((r) => ({ ...r }));
    }

    if (text.startsWith("select max(version) + 1 as next from oke_vault_secrets where path")) {
      const path = p[0];
      const versions = secrets.filter((r) => r.path === path).map((r) => Number(r.version));
      const max = versions.length === 0 ? null : Math.max(...versions);
      return [{ next: max === null ? null : max + 1 }];
    }

    if (
      text.startsWith("insert into oke_vault_secrets") &&
      text.includes("returning id, created_at, updated_at")
    ) {
      const now = new Date();
      const row: Row = {
        id: crypto.randomUUID(),
        path: p[0],
        encrypted_value: asBytes(p[1]),
        iv: asBytes(p[2]),
        auth_tag: asBytes(p[3]),
        version: p[4],
        metadata: typeof p[5] === "string" ? p[5] : JSON.stringify(p[5] ?? {}),
        algorithm: p[6],
        kek_version: p[7],
        expires_at: p[8] ?? null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      };
      secrets.push(row);
      return [{ id: row.id as string, created_at: now, updated_at: now }];
    }

    if (text.startsWith("insert into oke_vault_keys")) {
      keys.push({
        id: crypto.randomUUID(),
        secret_id: p[0],
        encrypted_dek: asBytes(p[1]),
        dek_iv: asBytes(p[2]),
        dek_auth_tag: asBytes(p[3]),
        algorithm: p[4],
        kek_version: p[5],
        created_at: new Date(),
      });
      return [];
    }

    if (text.startsWith("insert into oke_vault_master")) {
      const now = new Date();
      master.push({
        id: crypto.randomUUID(),
        key_hash: p[0],
        kek_version: p[1] ?? 1,
        created_at: now,
        updated_at: now,
      });
      return [];
    }

    if (text.startsWith("insert into oke_vault_audit")) {
      auditSeq += 1;
      audit.push({
        id: crypto.randomUUID(),
        seq: auditSeq,
        action: p[0],
        path: p[1] ?? null,
        actor_type: p[2],
        actor_id: p[3] ?? null,
        success: p[4],
        error_code: p[5] ?? null,
        error_message: p[6] ?? null,
        request_id: p[7] ?? null,
        prev_hash: p[8] ?? null,
        row_hash: p[9],
        created_at: p[10] instanceof Date ? p[10] : new Date(String(p[10])),
      });
      return [];
    }

    if (text.startsWith("update oke_vault_status")) {
      applyStatusUpdate(status, text, p);
      return [];
    }

    if (
      text.startsWith("update oke_vault_audit set row_hash") &&
      text.includes("where seq = (select max(seq) from oke_vault_audit)")
    ) {
      const last = [...audit].sort((a, b) => Number(b.seq) - Number(a.seq))[0];
      if (last) last.row_hash = p[0];
      return [];
    }

    if (
      text.startsWith("select encode(encrypted_value") ||
      text.startsWith("select encrypted_value")
    ) {
      return secrets.map((r) => {
        const bytes = asBytes(r.encrypted_value);
        if (text.includes("encode(")) {
          return { blob: Buffer.from(bytes).toString("latin1") };
        }
        return { encrypted_value: bytes };
      });
    }

    throw new Error(`memory vault sql: unsupported query: ${sql.trim().slice(0, 120)}`);
  }

  return {
    driverId: "memory",
    role: "primary",
    query,
    async exec(sql, params = []) {
      await query(sql, params);
      return { changes: 0 };
    },
    async close() {
      /* in-memory — nothing to release */
    },
  };
}

/** Collapse whitespace / case so template literals match. */
function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

/** DDL / index / alter — tables are implicit in the fake. */
function isDdl(text: string): boolean {
  return (
    text.startsWith("create table") ||
    text.startsWith("alter table") ||
    text.startsWith("create index")
  );
}

/** Seed the singleton status row (`id = 1`). */
function defaultStatus(): Row {
  return {
    id: 1,
    sealed: true,
    initialized: false,
    master_key_present: false,
    last_sealed_at: null,
    last_unsealed_at: null,
    seal_count: 0,
    rewrap_checkpoint: null,
    rewrap_target_kek_version: null,
    rewrap_key_hash: null,
    updated_at: new Date(),
  };
}

/**
 * Apply a status UPDATE by reading assigned columns from the SQL text.
 *
 * Vault only emits a handful of fixed UPDATE shapes; we mirror those
 * assignments rather than parsing a full SET grammar.
 */
function applyStatusUpdate(status: Row, text: string, params: unknown[]): void {
  const now = new Date();
  status.updated_at = now;

  if (text.includes("initialized = true")) {
    status.initialized = true;
    status.sealed = true;
    status.master_key_present = true;
    return;
  }

  if (text.includes("sealed = false") && text.includes("last_unsealed_at")) {
    status.sealed = false;
    status.last_unsealed_at = now;
    return;
  }

  if (text.includes("sealed = true") && text.includes("seal_count = seal_count + 1")) {
    status.sealed = true;
    status.last_sealed_at = now;
    status.seal_count = Number(status.seal_count ?? 0) + 1;
    return;
  }

  // Fallback: ignore unknown status updates (rotation checkpoints, etc.).
  void params;
}

/** Coerce driver-ish binary params to `Uint8Array`. */
function asBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value == null) return new Uint8Array();
  throw new Error(`memory vault sql: expected bytes, got ${typeof value}`);
}

/** Epoch-ms for ordering `created_at` columns. */
function toTime(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") return new Date(value).getTime();
  return 0;
}
