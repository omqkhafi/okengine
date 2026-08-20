/**
 * Real PGlite RLS isolation through {@link createSqlStoreHandle}.
 *
 * Covers the gap unit tests missed: a live policy, two concurrent identity
 * bags on one shared connection, and row-level isolation. PGlite `query`
 * rejects multi-command batches — the stamp must be split statements.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { connectPglite } from "../../drivers/pglite.ts";
import { connectPostgres } from "../../drivers/postgres.ts";
import { OKE_RLS_HELPER_SQL } from "../../drivers/pg-rls.ts";
import type { SqlConnection } from "../../drivers/types.ts";
import { createSqlStoreHandle, type SqlStoreHandle } from "./sql-session.ts";

const NOTES_DDL = `CREATE TABLE notes (
  id text PRIMARY KEY,
  owner text NOT NULL,
  body text NOT NULL
)`;

const OWNER_POLICY = `CREATE POLICY owner_select ON notes
  AS PERMISSIVE FOR SELECT TO public
  USING (owner = oke.user())`;

/** File-scoped warmed PGlite. */
let conn: SqlConnection;
/** Stamped as alice. */
let asAlice: SqlStoreHandle;
/** Stamped as bob. */
let asBob: SqlStoreHandle;
/** No stamp — table-owner / superuser bypass. */
let asOwner: SqlStoreHandle;

beforeAll(async () => {
  conn = await connectPglite({ url: "memory://sql-rls-isolation", role: "primary" });
  await conn.exec(NOTES_DDL);
  await conn.exec(`INSERT INTO notes VALUES ('a', 'alice', 'hi'), ('b', 'bob', 'yo')`);
  await conn.exec(`ALTER TABLE notes ENABLE ROW LEVEL SECURITY`);
  await conn.exec(OKE_RLS_HELPER_SQL);
  await conn.exec(OWNER_POLICY);
  asAlice = createSqlStoreHandle("sql:app", {
    connection: conn,
    classifications: new Map(),
    routedRole: "primary",
    domainDdl: "off",
    rls: { gate: "member", userId: "alice", scopes: ["member"] },
  });
  asBob = createSqlStoreHandle("sql:app", {
    connection: conn,
    classifications: new Map(),
    routedRole: "primary",
    domainDdl: "off",
    rls: { gate: "member", userId: "bob", scopes: ["member"] },
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

describe("sql-session RLS isolation (pglite)", () => {
  test("pglite query rejects a multi-command batch (the old prelude)", async () => {
    await expect(
      conn.query(
        "BEGIN; SET LOCAL row_security = on; SELECT set_config('oke.user', $1, true)",
        ["alice"],
      ),
    ).rejects.toThrow(/multiple commands/i);
  });

  test("sequential identities see only their rows", async () => {
    const alice = await asAlice.raw(`SELECT id, owner FROM notes ORDER BY id`);
    const bob = await asBob.raw(`SELECT id, owner FROM notes ORDER BY id`);
    expect(alice).toEqual([{ id: "a", owner: "alice" }]);
    expect(bob).toEqual([{ id: "b", owner: "bob" }]);
  });

  test("concurrent identities do not leak across the shared connection", async () => {
    const [alice, bob, aliceAgain] = await Promise.all([
      asAlice.raw(`SELECT id, owner FROM notes ORDER BY id`),
      asBob.raw(`SELECT id, owner FROM notes ORDER BY id`),
      asAlice.raw(`SELECT id, owner FROM notes ORDER BY id`),
    ]);
    expect(alice).toEqual([{ id: "a", owner: "alice" }]);
    expect(bob).toEqual([{ id: "b", owner: "bob" }]);
    expect(aliceAgain).toEqual([{ id: "a", owner: "alice" }]);
  });

  test("unstamped owner/superuser still sees every row", async () => {
    const rows = await asOwner.raw(`SELECT id, owner FROM notes ORDER BY id`);
    expect(rows).toEqual([
      { id: "a", owner: "alice" },
      { id: "b", owner: "bob" },
    ]);
  });
});

const LIVE_PG =
  process.env.OKE_TEST_DOCKER === "1" &&
  (process.env.DATABASE_URL ?? process.env.OKE_STORE_SQL_URL)?.startsWith("postgres");
if (!LIVE_PG) {
  console.log("skip: live Postgres RLS isolation needs OKE_TEST_DOCKER=1 and DATABASE_URL");
}

describe("sql-session RLS isolation (live postgres)", () => {
  const live = LIVE_PG ? test : test.skip;
  const table = "oke_rls_isolation_notes";

  live("split stamp isolates concurrent identities", async () => {
    const pg = await connectPostgres({
      url: process.env.DATABASE_URL ?? process.env.OKE_STORE_SQL_URL,
      role: "primary",
    });
    try {
      await pg.exec(`DROP TABLE IF EXISTS ${table}`);
      await pg.exec(
        `CREATE TABLE ${table} (id text PRIMARY KEY, owner text NOT NULL, body text NOT NULL)`,
      );
      await pg.exec(`INSERT INTO ${table} VALUES ('a', 'alice', 'hi'), ('b', 'bob', 'yo')`);
      await pg.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await pg.exec(OKE_RLS_HELPER_SQL);
      await pg.exec(
        `CREATE POLICY owner_select ON ${table} AS PERMISSIVE FOR SELECT TO public USING (owner = oke.user())`,
      );
      const alice = createSqlStoreHandle("sql:app", {
        connection: pg,
        classifications: new Map(),
        routedRole: "primary",
        domainDdl: "off",
        rls: { gate: "member", userId: "alice", scopes: ["member"] },
      });
      const bob = createSqlStoreHandle("sql:app", {
        connection: pg,
        classifications: new Map(),
        routedRole: "primary",
        domainDdl: "off",
        rls: { gate: "member", userId: "bob", scopes: ["member"] },
      });
      const [a, b] = await Promise.all([
        alice.raw(`SELECT id, owner FROM ${table} ORDER BY id`),
        bob.raw(`SELECT id, owner FROM ${table} ORDER BY id`),
      ]);
      expect(a).toEqual([{ id: "a", owner: "alice" }]);
      expect(b).toEqual([{ id: "b", owner: "bob" }]);
    } finally {
      try {
        await pg.exec(`DROP TABLE IF EXISTS ${table}`);
      } catch {
        // Best-effort cleanup.
      }
      await pg.close();
    }
  }, 20_000);
});
