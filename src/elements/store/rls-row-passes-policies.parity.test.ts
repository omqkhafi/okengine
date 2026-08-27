/**
 * RLS parity gate — `oke.row_passes_policies` replay vs native Postgres RLS.
 *
 * BLOCKING GATE for the Realtime round: every case constructs a real table,
 * installs real `CREATE POLICY` DDL, opens a REAL stamped store handle per
 * identity (same `rls` prelude production uses — `SET LOCAL ROLE oke_app`,
 * `set_config('oke.*')`, pinned transaction), reads ground truth natively,
 * then asserts the synthetic-JSONB replay returns the IDENTICAL boolean.
 *
 * Ground truth per command:
 * - SELECT/UPDATE/DELETE visibility → stamped point lookup `WHERE pk = $1`.
 * - INSERT / WITH CHECK → stamped INSERT attempt (accepted = policy passed).
 *
 * Policy families covered (adversarial, not happy-path):
 *   owner · tenant · gate · scope(string)
 * plus two mandatory multi-policy compositions:
 *   A. gate + owner — two PERMISSIVE policies, Postgres ORs them
 *      ("member + admin firehose" family)
 *   B. gate∧tenant compound USING + scope WITH CHECK ("tenant + scope" family)
 *
 * Run: bun test src/elements/store/rls-row-passes-policies.parity.test.ts
 *
 * Live-Postgres leg (parity must hold on real PG, not just PGlite):
 *   OKE_TEST_DOCKER=1 DATABASE_URL=postgres://… bun test src/elements/store/rls-row-passes-policies.parity.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { connectPglite } from "../../drivers/pglite.ts";
import { installOkeRlsHelpers, type RlsIdentity } from "../../drivers/pg-rls.ts";
import {
  ROW_PASSES_POLICIES_STATEMENTS as ROW_PASSES_STATEMENTS,
  buildInlineRowPassesSql,
} from "../../drivers/pg-rls-row-passes.ts";
import type { SqlConnection } from "../../drivers/types.ts";
import { createSqlStoreHandle, type SqlStoreHandle } from "./sql-session.ts";

/** Adversarial row image (JSONB payload shape mirrors table columns). */
type RowImage = Readonly<Record<string, unknown>>;

interface VisibilityCase {
  readonly name: string;
  readonly id: string;
  readonly row: RowImage;
  readonly visible: boolean;
}

const aliceMember: RlsIdentity = { gate: "member", userId: "alice", scopes: ["member"] };
const bobMember: RlsIdentity = { gate: "member", userId: "bob", scopes: ["member"] };
const acmeCreator: RlsIdentity = {
  gate: "member",
  userId: "u1",
  scopes: ["member", "invoices:create"],
  tenantId: "acme",
};
const acmeMemberNoScope: RlsIdentity = {
  gate: "member",
  userId: "u1",
  scopes: ["member"],
  tenantId: "acme",
};
const globexMember: RlsIdentity = {
  gate: "member",
  userId: "u1",
  scopes: ["member"],
  tenantId: "globex",
};

function handleFor(conn: SqlConnection, rls?: RlsIdentity): SqlStoreHandle {
  return createSqlStoreHandle("sql:parity", {
    connection: conn,
    classifications: new Map(),
    routedRole: "primary",
    domainDdl: "off",
    ...(rls ? { rls } : {}),
  });
}

/**
 * Compare native ground truth and replay verdicts for one visibility case.
 * Both probes run through the SAME stamped handle → identical GUC state.
 */
async function assertVisibilityParity(
  conn: SqlConnection,
  identity: RlsIdentity,
  table: string,
  testCase: VisibilityCase,
): Promise<void> {
  const h = handleFor(conn, identity);
  const errs: unknown[] = [];
  let native = false;
  let replay = false;

  try {
    const rows = await h.raw(`SELECT 1 AS ok FROM "${table}" WHERE id = ? LIMIT 1`, [testCase.id]);
    native = rows.length > 0;
  } catch (err) {
    errs.push(err);
  }
  try {
    const sql = buildInlineRowPassesSql(table, testCase.row, "SELECT");
    const out = await h.raw(sql, []);
    replay = out[0]?.ok === true;
  } catch (err) {
    errs.push(err);
  }

  if (errs.length > 0) throw errs[0];
  expect(replay).toBe(testCase.visible);
  expect(native).toBe(testCase.visible);
}

/** WITH CHECK parity via a real INSERT attempt under the stamp. */
async function assertInsertParity(
  conn: SqlConnection,
  identity: RlsIdentity,
  table: string,
  columns: string,
  placeholders: string,
  row: RowImage,
  values: readonly unknown[],
): Promise<void> {
  const h = handleFor(conn, identity);
  let accepted = false;
  try {
    await h.raw(`INSERT INTO "${table}" ${columns} VALUES ${placeholders}`, [...values]);
    accepted = true;
  } catch {
    accepted = false;
  }
  const inline = buildInlineRowPassesSql(table, row, "INSERT");
  const out = await h.raw(inline, []);
  const replay = out[0]?.ok === true;
  expect(replay).toBe(accepted);
}

describe("row_passes_policies install statements", () => {
  test("statements are single-command (no statement stacking)", () => {
    for (const stmt of ROW_PASSES_STATEMENTS) {
      expect(
        stmt.includes("COMMIT") ||
          stmt.includes(";") === false ||
          countTopLevelSemicolons(stmt) <= 0,
      ).toBe(true);
    }
  });
});

function countTopLevelSemicolons(sql: string): number {
  let inDollar = false;
  let count = 0;
  for (let i = 0; i < sql.length; i += 1) {
    if (sql.startsWith("$fn$", i)) {
      inDollar = !inDollar;
      i += 3;
      continue;
    }
    if (sql[i] === ";" && !inDollar) count += 1;
  }
  return count;
}

async function freshPglite(name: string): Promise<SqlConnection> {
  const c = await connectPglite({ url: `memory://${name}`, role: "primary" });
  await installOkeRlsHelpers((sql) => c.exec(sql));
  for (const stmt of ROW_PASSES_STATEMENTS) await c.exec(stmt);
  return c;
}

describe("RLS parity — owner family (pglite)", () => {
  let conn: SqlConnection;
  let seed: SqlStoreHandle;

  beforeAll(async () => {
    conn = await freshPglite("parity-owner");
    await conn.exec(`CREATE TABLE notes (
      id text PRIMARY KEY, owner text NOT NULL, body text NOT NULL)`);
    await conn.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON notes TO oke_app`);
    await conn.exec(`ALTER TABLE notes ENABLE ROW LEVEL SECURITY`);
    await conn.exec(`CREATE POLICY owner_all ON notes
      AS PERMISSIVE FOR ALL TO public USING (owner = oke.user()) WITH CHECK (owner = oke.user())`);
    // Seed as the table owner (connection user bypasses RLS on own tables).
    seed = handleFor(conn);
    await seed.raw(`INSERT INTO notes VALUES ('a','alice','hi'), ('b','bob','yo')`);
  }, 30_000);

  afterAll(async () => {
    await conn.close();
  });

  test("own row passes; other's row denied — SELECT and UPDATE contexts", async () => {
    await assertVisibilityParity(conn, aliceMember, "notes", {
      name: "alice sees own row",
      id: "a",
      row: { id: "a", owner: "alice", body: "hi" },
      visible: true,
    });
    await assertVisibilityParity(conn, aliceMember, "notes", {
      name: "alice denied bob row",
      id: "b",
      row: { id: "b", owner: "bob", body: "yo" },
      visible: false,
    });
    await assertVisibilityParity(conn, bobMember, "notes", {
      name: "bob before-image of alice-owned row invisible (revoked path)",
      id: "a",
      row: { id: "a", owner: "alice", body: "moved" },
      visible: false,
    });
  });

  test("empty userId denies everything (adversarial)", async () => {
    await assertVisibilityParity(conn, { gate: "public", userId: "", scopes: [] }, "notes", {
      name: "anonymous denied",
      id: "a",
      row: { id: "a", owner: "alice", body: "hi" },
      visible: false,
    });
  });
});

describe("RLS parity — tenant family (pglite)", () => {
  let conn: SqlConnection;

  beforeAll(async () => {
    conn = await freshPglite("parity-tenant");
    await conn.exec(`CREATE TABLE bookings (
      id text PRIMARY KEY, tenant_id text NOT NULL, body text NOT NULL)`);
    await conn.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON bookings TO oke_app`);
    await conn.exec(`ALTER TABLE bookings ENABLE ROW LEVEL SECURITY`);
    await conn.exec(`CREATE POLICY tenant_all ON bookings
      AS PERMISSIVE FOR ALL TO public
      USING (tenant_id = oke.tenant()) WITH CHECK (tenant_id = oke.tenant())`);
    await handleFor(conn).raw(`INSERT INTO bookings VALUES ('1','acme','a'), ('2','globex','b')`);
  }, 30_000);

  afterAll(async () => {
    await conn.close();
  });

  test("matching tenant passes; cross-tenant denied", async () => {
    await assertVisibilityParity(conn, acmeMemberNoScope, "bookings", {
      name: "acme sees acme row",
      id: "1",
      row: { id: "1", tenant_id: "acme", body: "a" },
      visible: true,
    });
    await assertVisibilityParity(conn, globexMember, "bookings", {
      name: "globex denied acme row",
      id: "1",
      row: { id: "1", tenant_id: "acme", body: "a" },
      visible: false,
    });
  });

  test("reassigned-away row: after-image invisible, before-image replayable (CDC semantics)", async () => {
    // Real CDC scenario: id=2 belonged to acme ("was-mine"), then an
    // unstamped/admin UPDATE reassigned it to globex. Classifying that event
    // for an acme subscriber means:
    //   1. after-image on heap → native stamped lookup is EMPTY (revoked)
    //   2. BEFORE-image {id:'2',tenant_id:'acme'} was visible under the
    //      acme stamp — `row_passes_policies` must agree (delete path).
    const acme = handleFor(conn, acmeMemberNoScope);

    // Simulate the reassignment as the table owner (a stamped acme session
    // cannot push its own row out of tenant scope — mirrors production,
    // where cross-tenant moves happen through admin/unstamped writes).
    await handleFor(conn).raw(`UPDATE bookings SET tenant_id = 'globex' WHERE id = '2'`);

    // Native ground truth: after-image invisible.
    const rows = await acme.raw(`SELECT 1 AS ok FROM bookings WHERE id = '2' LIMIT 1`);
    expect(rows.length).toBe(0);

    // Replay parity: before-image visible.
    const probe = buildInlineRowPassesSql(
      "bookings",
      { id: "2", tenant_id: "acme", body: "was-mine" },
      "SELECT",
    );
    const out = await acme.raw(probe, []);
    expect(out[0]?.ok).toBe(true);
  });

  test("missing tenant GUC denies everything", async () => {
    await assertVisibilityParity(
      conn,
      { gate: "member", userId: "u1", scopes: ["member"] },
      "bookings",
      {
        name: "no tenant stamp denied",
        id: "1",
        row: { id: "1", tenant_id: "acme", body: "a" },
        visible: false,
      },
    );
  });
});

describe("RLS parity — gate + scope families (pglite)", () => {
  let conn: SqlConnection;

  beforeAll(async () => {
    conn = await freshPglite("parity-gate-scope");
    await conn.exec(`CREATE TABLE secrets (
      id text PRIMARY KEY, visibility text NOT NULL, payload text NOT NULL)`);
    await conn.exec(`GRANT SELECT, INSERT ON secrets TO oke_app`);
    await conn.exec(`ALTER TABLE secrets ENABLE ROW LEVEL SECURITY`);
    await conn.exec(`CREATE POLICY member_select ON secrets
      AS PERMISSIVE FOR SELECT TO public USING (oke.gate() = 'member')`);
    await conn.exec(`CREATE POLICY scope_insert ON secrets
      AS PERMISSIVE FOR INSERT TO public WITH CHECK (oke.has_scope('secrets:write'))`);
    await handleFor(conn).raw(`INSERT INTO secrets VALUES ('s1','public','x')`);
  }, 30_000);

  afterAll(async () => {
    await conn.close();
  });

  test("gate match passes; wrong gate denied", async () => {
    await assertVisibilityParity(conn, aliceMember, "secrets", {
      name: "member select allowed",
      id: "s1",
      row: { id: "s1", visibility: "public", payload: "x" },
      visible: true,
    });
    await assertVisibilityParity(
      conn,
      { gate: "partner", userId: "u9", scopes: ["partner"] },
      "secrets",
      {
        name: "partner gate denied",
        id: "s1",
        row: { id: "s1", visibility: "public", payload: "x" },
        visible: false,
      },
    );
  });

  test("scope literal survives rewrite ('secrets:write' is not a column)", async () => {
    await assertInsertParity(
      conn,
      { ...aliceMember, scopes: ["secrets:write"] },
      "secrets",
      "(id, visibility, payload)",
      "(?, ?, ?)",
      { id: "s2", visibility: "internal", payload: "y" },
      ["s2", "internal", "y"],
    );
    await assertInsertParity(
      conn,
      { ...aliceMember, scopes: [] },
      "secrets",
      "(id, visibility, payload)",
      "(?, ?, ?)",
      { id: "s3", visibility: "internal", payload: "z" },
      ["s3", "internal", "z"],
    );
  });
});

describe("RLS parity — composition A: gate + owner, two PERMISSIVE (pglite)", () => {
  let conn: SqlConnection;

  beforeAll(async () => {
    conn = await freshPglite("parity-comp-a");
    await conn.exec(`CREATE TABLE docs (
      id text PRIMARY KEY, owner text NOT NULL, title text NOT NULL)`);
    await conn.exec(`GRANT SELECT ON docs TO oke_app`);
    await conn.exec(`ALTER TABLE docs ENABLE ROW LEVEL SECURITY`);
    await conn.exec(`CREATE POLICY member_select ON docs
      AS PERMISSIVE FOR SELECT TO public USING (oke.gate() = 'member')`);
    await conn.exec(`CREATE POLICY owner_select ON docs
      AS PERMISSIVE FOR SELECT TO public USING (owner = oke.user())`);
    await handleFor(conn).raw(`INSERT INTO docs VALUES ('d1','zara','hers'), ('d2','ali','his')`);
  }, 30_000);

  afterAll(async () => {
    await conn.close();
  });

  test("permissive OR — member non-owner via gate; guest owner via owner; guest stranger denied", async () => {
    await assertVisibilityParity(conn, bobMember, "docs", {
      name: "member non-owner sees via gate policy",
      id: "d1",
      row: { id: "d1", owner: "zara", title: "hers" },
      visible: true,
    });
    await assertVisibilityParity(
      conn,
      { gate: "guest", userId: "ali", scopes: ["guest"] },
      "docs",
      {
        name: "guest owner sees via owner policy",
        id: "d2",
        row: { id: "d2", owner: "ali", title: "his" },
        visible: true,
      },
    );
    await assertVisibilityParity(
      conn,
      { gate: "guest", userId: "mallory", scopes: ["guest"] },
      "docs",
      {
        name: "guest stranger denied by both",
        id: "d1",
        row: { id: "d1", owner: "zara", title: "hers" },
        visible: false,
      },
    );
  });
});

describe("RLS parity — composition B: gate∧tenant compound + scope INSERT (pglite)", () => {
  let conn: SqlConnection;

  beforeAll(async () => {
    conn = await freshPglite("parity-comp-b");
    await conn.exec(`CREATE TABLE invoices (
      id text PRIMARY KEY, tenant_id text NOT NULL, total integer NOT NULL)`);
    await conn.exec(`GRANT SELECT, INSERT ON invoices TO oke_app`);
    await conn.exec(`ALTER TABLE invoices ENABLE ROW LEVEL SECURITY`);
    await conn.exec(`CREATE POLICY member_select ON invoices
      AS PERMISSIVE FOR SELECT TO public
      USING (oke.gate() = 'member' AND tenant_id = oke.tenant())`);
    await conn.exec(`CREATE POLICY scope_insert ON invoices
      AS PERMISSIVE FOR INSERT TO public WITH CHECK (oke.has_scope('invoices:create'))`);
    await handleFor(conn).raw(`INSERT INTO invoices VALUES ('i1','acme',100)`);
  }, 30_000);

  afterAll(async () => {
    await conn.close();
  });

  test("compound expression respects tenant conjunct", async () => {
    await assertVisibilityParity(conn, acmeCreator, "invoices", {
      name: "acme member sees own invoice",
      id: "i1",
      row: { id: "i1", tenant_id: "acme", total: 100 },
      visible: true,
    });
    await assertVisibilityParity(conn, globexMember, "invoices", {
      name: "globex member denied acme invoice",
      id: "i1",
      row: { id: "i1", tenant_id: "acme", total: 100 },
      visible: false,
    });
  });

  test("INSERT requires invoices:create scope even when tenant matches", async () => {
    await assertInsertParity(
      conn,
      acmeMemberNoScope,
      "invoices",
      "(id, tenant_id, total)",
      "(?, ?, ?)",
      { id: "i2", tenant_id: "acme", total: 5 },
      ["i2", "acme", 5],
    );
    await assertInsertParity(
      conn,
      acmeCreator,
      "invoices",
      "(id, tenant_id, total)",
      "(?, ?, ?)",
      { id: "i3", tenant_id: "acme", total: 7 },
      ["i3", "acme", 7],
    );
  });
});

describe("RLS parity — regression gate: TO-role + command-clause selection (pglite)", () => {
  // Added after the adversarial audit (release-blocking finding round):
  //
  // 1. TO-ROLE LEAK — a PERMISSIVE policy granted `TO <role>` where the stamp
  //    role is NOT a member must be invisible to native evaluation. The old
  //    replay ignored pg_policies.roles entirely, so an internal wide policy
  //    (TO internal_role USING (true)) falsely widened every subscriber's
  //    visibility through the replay path.
  //
  // 2. INSERT CLAUSE SELECTION — native INSERT evaluates WITH CHECK only;
  //    the old replay evaluated qual-first and skipped INSERT-only policies,
  //    diverging whenever a table mixes ALL/UPDATE policies with distinct
  //    USING/WITH CHECK clauses.

  let conn: SqlConnection;

  beforeAll(async () => {
    conn = await freshPglite("parity-regressions");
    await conn.exec(`CREATE TABLE tenant_wide (
      id text PRIMARY KEY, tenant_id text NOT NULL, note text NOT NULL)`);
    await conn.exec(`GRANT SELECT, INSERT ON tenant_wide TO oke_app`);
    await conn.exec(`ALTER TABLE tenant_wide ENABLE ROW LEVEL SECURITY`);
    await conn.exec(`CREATE POLICY tenant_sel ON tenant_wide
      AS PERMISSIVE FOR SELECT TO public
      USING (tenant_id = oke.tenant())`);
    // Non-applicable role: oke_app has no membership in oke_internal —
    // natively this policy never applies to stamped sessions.
    await conn.exec(`DO $do$ BEGIN
      CREATE ROLE oke_internal NOLOGIN;
    EXCEPTION WHEN duplicate_object THEN NULL; END $do$`);
    await conn.exec(`CREATE POLICY wide_internal ON tenant_wide
      AS PERMISSIVE FOR SELECT TO oke_internal
      USING (true)`);
    await handleFor(conn).raw(`INSERT INTO tenant_wide VALUES ('1','acme','secret')`);

    await conn.exec(`CREATE TABLE mixed_cmds (
      id text PRIMARY KEY, tenant_id text NOT NULL)`);
    await conn.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON mixed_cmds TO oke_app`);
    await conn.exec(`ALTER TABLE mixed_cmds ENABLE ROW LEVEL SECURITY`);
    // ALL policy with deliberately DISTINCT USING vs WITH CHECK:
    await conn.exec(`CREATE POLICY upsert_all ON mixed_cmds
      AS PERMISSIVE FOR ALL TO public
      USING (tenant_id = oke.tenant())
      WITH CHECK (tenant_id <> 'locked')`);
    await handleFor(conn).raw(`INSERT INTO mixed_cmds VALUES ('0','base')`);
  }, 30_000);

  afterAll(async () => {
    await conn.close();
  });

  test("regression: TO-restricted permissive policy must NOT widen replay visibility", async () => {
    const globexMemberNoTenantMatch = { ...globexMember };
    const h = handleFor(conn, globexMemberNoTenantMatch);
    // Native ground truth: only tenant_sel applies (wide_internal is TO
    // oke_internal); globex is not 'acme' → row invisible.
    const rows = await h.raw(`SELECT 1 AS ok FROM "tenant_wide" WHERE id = ? LIMIT 1`, ["1"]);
    expect(rows.length).toBe(0);
    // Replay must agree — old fn returned true here (LEAK).
    const inline = buildInlineRowPassesSql("tenant_wide", { id: "1", tenant_id: "acme", note: "secret" }, "SELECT");
    const out = await h.raw(inline, []);
    expect(out[0]?.ok === true).toBe(false);
  });

  test("regression: INSERT evaluates WITH CHECK even when ALL-policy USING denies", async () => {
    // Native: INSERT on mixed_cmds evaluates ONLY WC (tenant<>'locked') →
    // a globex-stamped insert of an 'acme' row is ACCEPTED despite the
    // USING clause disagreeing with the stamp's tenant.
    let accepted = false;
    try {
      await handleFor(conn, globexMember).raw(
        `INSERT INTO "mixed_cmds" ("id", "tenant_id") VALUES (?, ?)`,
        ["9", "acme"],
      );
      accepted = true;
    } catch {
      accepted = false;
    }
    expect(accepted).toBe(true);
    // Replay must agree — old fn evaluated USING (qual) first and denied.
    const out = await handleFor(conn, globexMember).raw(
      buildInlineRowPassesSql("mixed_cmds", { id: "9", tenant_id: "acme" }, "INSERT"),
      [],
    );
    expect(out[0]?.ok === true).toBe(true);
  });
});

/**
 * Live-Postgres leg — same parity matrix executed against real Postgres.
 * The rewrite algorithm is pure SQL text manipulation; the risky deltas
 * between PGlite and real PG are catalog contents (pg_policies.qual
 * formatting) and regex behavior. Both must hold identically or the gate
 * fails loudly here.
 */
const LIVE_PG =
  process.env.OKE_TEST_DOCKER === "1" &&
  (process.env.DATABASE_URL ?? process.env.OKE_STORE_SQL_URL)?.startsWith("postgres");
if (!LIVE_PG) {
  console.log("skip: live Postgres parity needs OKE_TEST_DOCKER=1 and DATABASE_URL");
}

describe.skipIf(!LIVE_PG)("RLS parity — owner family (live postgres)", () => {
  // describe.skipIf also skips beforeAll/afterAll — plain `test.skip` would
  // still open a live PG connection and fail loud on ECONNREFUSED.
  let conn: SqlConnection;

  beforeAll(async () => {
    const { connectPostgres } = await import("../../drivers/postgres.ts");
    conn = await connectPostgres({
      url: process.env.DATABASE_URL ?? process.env.OKE_STORE_SQL_URL!,
      role: "primary",
    });
    await installOkeRlsHelpers((sql) => conn.exec(sql));
    for (const stmt of ROW_PASSES_STATEMENTS) await conn.exec(stmt);
    await conn.exec(`DROP TABLE IF EXISTS oke_parity_notes`);
    await conn.exec(`CREATE TABLE oke_parity_notes (
      id text PRIMARY KEY, owner text NOT NULL, body text NOT NULL)`);
    await conn.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON oke_parity_notes TO oke_app`);
    await conn.exec(`ALTER TABLE oke_parity_notes ENABLE ROW LEVEL SECURITY`);
    await conn.exec(`CREATE POLICY owner_all ON oke_parity_notes
      AS PERMISSIVE FOR ALL TO public USING (owner = oke.user()) WITH CHECK (owner = oke.user())`);
    const seed = handleFor(conn);
    await seed.raw(`INSERT INTO oke_parity_notes VALUES ('a','alice','hi'), ('b','bob','yo')`);
  }, 30_000);

  afterAll(async () => {
    await conn.exec(`DROP TABLE IF EXISTS oke_parity_notes`);
    await conn.close();
  });

  test("replay matches native stamped verdicts", async () => {
    await assertVisibilityParity(conn, aliceMember, "oke_parity_notes", {
      name: "alice sees own row",
      id: "a",
      row: { id: "a", owner: "alice", body: "hi" },
      visible: true,
    });
    await assertVisibilityParity(conn, aliceMember, "oke_parity_notes", {
      name: "alice denied bob row",
      id: "b",
      row: { id: "b", owner: "bob", body: "yo" },
      visible: false,
    });
  });

  test("compound + scope expressions survive PG catalog round-trip", async () => {
    await conn.exec(`DROP TABLE IF EXISTS oke_parity_invoices`);
    await conn.exec(`CREATE TABLE oke_parity_invoices (
      id text PRIMARY KEY, tenant_id text NOT NULL, total integer NOT NULL)`);
    await conn.exec(`GRANT SELECT, INSERT ON oke_parity_invoices TO oke_app`);
    await conn.exec(`ALTER TABLE oke_parity_invoices ENABLE ROW LEVEL SECURITY`);
    await conn.exec(`CREATE POLICY member_select ON oke_parity_invoices
      AS PERMISSIVE FOR SELECT TO public
      USING (oke.gate() = 'member' AND tenant_id = oke.tenant())`);
    await conn.exec(`CREATE POLICY scope_insert ON oke_parity_invoices
      AS PERMISSIVE FOR INSERT TO public WITH CHECK (oke.has_scope('invoices:create'))`);
    await handleFor(conn).raw(`INSERT INTO oke_parity_invoices VALUES ('i1','acme',100)`);

    await assertVisibilityParity(conn, acmeCreator, "oke_parity_invoices", {
      name: "acme member sees own invoice",
      id: "i1",
      row: { id: "i1", tenant_id: "acme", total: 100 },
      visible: true,
    });
    await assertVisibilityParity(conn, globexMember, "oke_parity_invoices", {
      name: "globex member denied acme invoice",
      id: "i1",
      row: { id: "i1", tenant_id: "acme", total: 100 },
      visible: false,
    });
    await assertInsertParity(
      conn,
      acmeMemberNoScope,
      "oke_parity_invoices",
      "(id, tenant_id, total)",
      "(?, ?, ?)",
      { id: "i2", tenant_id: "acme", total: 5 },
      ["i2", "acme", 5],
    );
    await assertInsertParity(
      conn,
      acmeCreator,
      "oke_parity_invoices",
      "(id, tenant_id, total)",
      "(?, ?, ?)",
      { id: "i4", tenant_id: "acme", total: 9 },
      ["i4", "acme", 9],
    );
    await conn.exec(`DROP TABLE IF EXISTS oke_parity_invoices`);
  }, 30_000);
});
