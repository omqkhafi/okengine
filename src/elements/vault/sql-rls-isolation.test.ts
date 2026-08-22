/**
 * `oke_vault_secrets` tenant RLS — same concurrent-identity proof as
 * domain tables: two tenants, one shared PGlite connection, row-level
 * isolation via `oke.tenant()`.
 *
 * Policy is installed by production DDL ({@link ensureVaultTables} /
 * {@link installOkeRlsHelpers}), not by this file.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { connectPglite } from "../../drivers/pglite.ts";
import { installOkeRlsHelpers } from "../../drivers/pg-rls.ts";
import type { SqlConnection } from "../../drivers/types.ts";
import { createSqlStoreHandle, type SqlStoreHandle } from "../store/sql-session.ts";
import { sqlConnectionAsExec } from "./builtin-adapter.ts";
import { ensureVaultTables } from "./storage.ts";

const CIPHER = String.raw`'\x00'::bytea`;

const SEED = `
INSERT INTO oke_vault_secrets (path, encrypted_value, iv, auth_tag, version, tenant_id)
VALUES
  ('acme/stripe', ${CIPHER}, ${CIPHER}, ${CIPHER}, 1, 'acme'),
  ('globex/stripe', ${CIPHER}, ${CIPHER}, ${CIPHER}, 1, 'globex'),
  ('GLOBAL_KEY', ${CIPHER}, ${CIPHER}, ${CIPHER}, 1, NULL)
`;

/** File-scoped warmed PGlite. */
let conn: SqlConnection;
/** Stamped as tenant acme. */
let asAcme: SqlStoreHandle;
/** Stamped as tenant globex. */
let asGlobex: SqlStoreHandle;
/** No stamp — table-owner / superuser bypass (ENABLE without FORCE). */
let asOwner: SqlStoreHandle;

beforeAll(async () => {
  conn = await connectPglite({ url: "memory://vault-sql-rls-isolation", role: "primary" });
  await installOkeRlsHelpers((sql) => conn.exec(sql));
  await ensureVaultTables(sqlConnectionAsExec(conn));
  await conn.exec(SEED);
  asAcme = createSqlStoreHandle("sql:app", {
    connection: conn,
    classifications: new Map(),
    routedRole: "primary",
    domainDdl: "off",
    rls: { gate: "member", userId: "u1", scopes: ["member"], tenantId: "acme" },
  });
  asGlobex = createSqlStoreHandle("sql:app", {
    connection: conn,
    classifications: new Map(),
    routedRole: "primary",
    domainDdl: "off",
    rls: { gate: "member", userId: "u1", scopes: ["member"], tenantId: "globex" },
  });
  asOwner = createSqlStoreHandle("sql:app", {
    connection: conn,
    classifications: new Map(),
    routedRole: "primary",
    domainDdl: "off",
  });
}, 15_000);

afterAll(async () => {
  await conn.close();
});

describe("oke_vault_secrets tenant RLS (pglite)", () => {
  test("production DDL installed oke_vault_secrets_tenant", async () => {
    const rows = await conn.query(
      `SELECT policyname FROM pg_policies
       WHERE tablename = 'oke_vault_secrets' AND policyname = 'oke_vault_secrets_tenant'`,
    );
    expect(rows).toEqual([{ policyname: "oke_vault_secrets_tenant" }]);
  });

  test("sequential identities see own tenant plus global NULL rows", async () => {
    const acme = await asAcme.raw(`SELECT path, tenant_id FROM oke_vault_secrets ORDER BY path`);
    const globex = await asGlobex.raw(
      `SELECT path, tenant_id FROM oke_vault_secrets ORDER BY path`,
    );
    expect(acme).toEqual([
      { path: "GLOBAL_KEY", tenant_id: null },
      { path: "acme/stripe", tenant_id: "acme" },
    ]);
    expect(globex).toEqual([
      { path: "GLOBAL_KEY", tenant_id: null },
      { path: "globex/stripe", tenant_id: "globex" },
    ]);
  });

  test("concurrent identities do not leak across the shared connection", async () => {
    const [acme, globex, acmeAgain] = await Promise.all([
      asAcme.raw(`SELECT path, tenant_id FROM oke_vault_secrets ORDER BY path`),
      asGlobex.raw(`SELECT path, tenant_id FROM oke_vault_secrets ORDER BY path`),
      asAcme.raw(`SELECT path, tenant_id FROM oke_vault_secrets ORDER BY path`),
    ]);
    expect(acme).toEqual([
      { path: "GLOBAL_KEY", tenant_id: null },
      { path: "acme/stripe", tenant_id: "acme" },
    ]);
    expect(globex).toEqual([
      { path: "GLOBAL_KEY", tenant_id: null },
      { path: "globex/stripe", tenant_id: "globex" },
    ]);
    expect(acmeAgain).toEqual([
      { path: "GLOBAL_KEY", tenant_id: null },
      { path: "acme/stripe", tenant_id: "acme" },
    ]);
  });

  test("unstamped owner still sees every ciphertext row", async () => {
    const rows = await asOwner.raw(`SELECT path, tenant_id FROM oke_vault_secrets ORDER BY path`);
    expect(rows).toEqual([
      { path: "GLOBAL_KEY", tenant_id: null },
      { path: "acme/stripe", tenant_id: "acme" },
      { path: "globex/stripe", tenant_id: "globex" },
    ]);
  });
});

describe("oke_vault_secrets tenant RLS — tables before helpers", () => {
  test("helper install attaches the policy after the table exists", async () => {
    const late = await connectPglite({
      url: "memory://vault-sql-rls-late-helpers",
      role: "primary",
    });
    try {
      await ensureVaultTables(sqlConnectionAsExec(late));
      const before = await late.query(
        `SELECT COUNT(*)::text AS n FROM pg_policies
         WHERE tablename = 'oke_vault_secrets' AND policyname = 'oke_vault_secrets_tenant'`,
      );
      expect(before[0]?.n).toBe("0");
      await installOkeRlsHelpers((sql) => late.exec(sql));
      const after = await late.query(
        `SELECT COUNT(*)::text AS n FROM pg_policies
         WHERE tablename = 'oke_vault_secrets' AND policyname = 'oke_vault_secrets_tenant'`,
      );
      expect(after[0]?.n).toBe("1");
    } finally {
      await late.close();
    }
  });
});
