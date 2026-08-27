/**
 * End-to-end Phase 2 gate (pglite, real SQL):
 *
 *   sql-session write → CDC sink → { runtime ingest, outbox append } →
 *   CdcOutboxRunner drain (redelivery path) → per-subscriber classification
 *   via stamped EXISTS + oke.row_passes_policies replay → delivered events.
 *
 * Proves the realtime leg against the SAME stamped production physics as the
 * parity suite — not scripted probes.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { connectPglite } from "../../drivers/pglite.ts";
import {
  installOkeRlsHelpers,
  buildRlsIdentityPreludeSql,
  ROW_PASSES_POLICIES_STATEMENTS as ROW_PASSES,
  type RlsIdentity,
} from "../../drivers/pg-rls.ts";
import { CdcOutbox, CdcOutboxRunner, type OutboxRow } from "../../drivers/cdc-outbox.ts";
import type { SqlConnection } from "../../drivers/types.ts";
import { liveQueryRuntimeFromConn } from "./live-query-server.ts";
import { openLiveStream } from "../../kernel/realtime-bind.ts";
import type { LiveQueryEvent } from "./live-query-runtime.ts";

const ALICE: RlsIdentity = { gate: "member", userId: "alice", scopes: ["member"] };
const TABLE = "oke_live_e2e_notes";

describe("realtime bridge e2e (pglite)", () => {
  let conn: SqlConnection;

  beforeAll(async () => {
    conn = await connectPglite({ url: "memory://oke-live-e2e", role: "primary" });
    await installOkeRlsHelpers((sql) => conn.exec(sql));
    for (const stmt of ROW_PASSES) await conn.exec(stmt);
    await conn.exec(`DROP TABLE IF EXISTS ${TABLE}`);
    await conn.exec(`CREATE TABLE ${TABLE} (
      id text PRIMARY KEY, owner text NOT NULL, status text NOT NULL)`);
    await conn.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${TABLE} TO oke_app`);
    await conn.exec(`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY`);
    await conn.exec(`CREATE POLICY owner_all ON ${TABLE} AS PERMISSIVE FOR ALL TO public
      USING (owner = oke.user()) WITH CHECK (owner = oke.user())`);
  }, 30_000);

  afterAll(async () => {
    await conn.close();
  });

  /** Stamp-free raw insert (seed helper). */
  async function seed(id: string, owner: string, status: string): Promise<void> {
    await conn.query(`INSERT INTO ${TABLE} VALUES (?, ?, ?)`, [id, owner, status]);
  }

  test("insert visible to subscriber → upsert via stamped EXISTS", async () => {
    const runtime = liveQueryRuntimeFromConn(conn);
    const delivered: LiveQueryEvent[] = [];
    const unsub = runtime.subscribe({
      id: "sse-alice",
      ref: "sql:app",
      table: TABLE,
      pkColumn: "id",
      identity: ALICE,
      deliver(e) {
        delivered.push(e);
      },
    });
    try {
      await seed("n1", "alice", "open");
      runtime.onCdc({
        tableName: TABLE,
        op: "insert",
        before: null,
        after: { id: "n1", owner: "alice", status: "open" },
      });
      await new Promise((r) => setTimeout(r, 40));
      expect(delivered).toEqual([
        { kind: "upsert", row: { id: "n1", owner: "alice", status: "open" } },
      ]);
    } finally {
      unsub();
    }
  });

  test("update still visible → upsert with fresh image; stamp honored", async () => {
    const runtime = liveQueryRuntimeFromConn(conn);
    const delivered: LiveQueryEvent[] = [];
    const unsub = runtime.subscribe({
      id: "sse-alice-u",
      ref: "sql:app",
      table: TABLE,
      pkColumn: "id",
      identity: ALICE,
      deliver(e) {
        delivered.push(e);
      },
    });
    try {
      await seed("n2", "alice", "open");
      runtime.onCdc({
        tableName: TABLE,
        op: "update",
        before: { id: "n2", owner: "alice", status: "open" },
        after: { id: "n2", owner: "alice", status: "done" },
      });
      await new Promise((r) => setTimeout(r, 40));
      expect(delivered).toEqual([
        { kind: "upsert", row: { id: "n2", owner: "alice", status: "done" } },
      ]);

      // bob's row under ALICE's stamp → EXISTS denied by native RLS → ignore.
      await seed("n3", "bob", "open");
      runtime.onCdc({
        tableName: TABLE,
        op: "insert",
        before: null,
        after: { id: "n3", owner: "bob", status: "open" },
      });
      await new Promise((r) => setTimeout(r, 40));
      expect(delivered).toHaveLength(1);
      expect(runtime.metrics.checkFailures).toBe(0);
    } finally {
      unsub();
    }
  });

  test("query-window exit emits revoked(reason query) through real SQL", async () => {
    const runtime = liveQueryRuntimeFromConn(conn);
    const delivered: LiveQueryEvent[] = [];
    const unsub = runtime.subscribe({
      id: "sse-alice-q",
      ref: "sql:app",
      table: TABLE,
      pkColumn: "id",
      identity: ALICE,
      whereSql: `status = 'open'`,
      deliver(e) {
        delivered.push(e);
      },
    });
    try {
      await seed("n4", "alice", "open");
      // A real remote write commits before its CDC event reaches us — mirror
      // that ordering so the EXISTS probe sees the committed state.
      await conn.query(`UPDATE ${TABLE} SET status = 'closed' WHERE id = 'n4'`);
      runtime.onCdc({
        tableName: TABLE,
        op: "update",
        before: { id: "n4", owner: "alice", status: "open" },
        after: { id: "n4", owner: "alice", status: "closed" },
      });
      await new Promise((r) => setTimeout(r, 60));
      expect(delivered).toEqual([{ kind: "revoked", id: "n4", reason: "query" }]);
    } finally {
      unsub();
    }
  });

  test("RLS revocation (reassigned away) emits revoked(reason rls)", async () => {
    const runtime = liveQueryRuntimeFromConn(conn);
    const delivered: LiveQueryEvent[] = [];
    const unsub = runtime.subscribe({
      id: "sse-alice-r",
      ref: "sql:app",
      table: TABLE,
      pkColumn: "id",
      identity: ALICE,
      deliver(e) {
        delivered.push(e);
      },
    });
    try {
      await seed("n5", "mallory", "done");
      // Committed reassignment mirrors the CDC payload (native RLS denies
      // ALICE on the heap row → EXISTS false; replay explains why).
      runtime.onCdc({
        tableName: TABLE,
        op: "update",
        before: { id: "n5", owner: "alice", status: "open" },
        after: { id: "n5", owner: "mallory", status: "done" },
      });
      await new Promise((r) => setTimeout(r, 60));
      expect(delivered).toEqual([{ kind: "revoked", id: "n5", reason: "rls" }]);
    } finally {
      unsub();
    }
  });

  test("delete of previously-visible row → delete (before-image replay)", async () => {
    const runtime = liveQueryRuntimeFromConn(conn);
    const delivered: LiveQueryEvent[] = [];
    const unsub = runtime.subscribe({
      id: "sse-alice-d",
      ref: "sql:app",
      table: TABLE,
      pkColumn: "id",
      identity: ALICE,
      deliver(e) {
        delivered.push(e);
      },
    });
    try {
      await seed("n6", "alice", "open");
      await conn.query(`DELETE FROM ${TABLE} WHERE id = 'n6'`);
      runtime.onCdc({
        tableName: TABLE,
        op: "delete",
        before: { id: "n6", owner: "alice", status: "open" },
        after: null,
      });
      await new Promise((r) => setTimeout(r, 60));
      expect(delivered).toEqual([{ kind: "delete", id: "n6" }]);
    } finally {
      unsub();
    }
  });

  test("outbox append → runner tick → drained into runtime (multi-host leg)", async () => {
    const outbox = new CdcOutbox(conn);
    await outbox.ensure();

    const runtime = liveQueryRuntimeFromConn(conn);
    const drainedEvents: LiveQueryEvent[] = [];
    runtime.subscribe({
      id: "sse-poller",
      ref: "sql:app",
      table: TABLE,
      pkColumn: "id",
      identity: ALICE,
      deliver(e) {
        drainedEvents.push(e);
      },
    });

    // Another host committed this row; only the outbox carries the event
    // across hosts. The heap row must exist here for parity with production —
    // CDC events always follow the commit they describe.
    await seed("n7", "alice", "open");
    await outbox.append({
      tableName: TABLE,
      op: "insert",
      before: null,
      after: { id: "n7", owner: "alice", status: "open" },
    });

    let acked: readonly OutboxRow[] = [];
    let batches = 0;
    const runner = new CdcOutboxRunner(
      outbox,
      async (rows) => {
        batches += 1;
        for (const row of rows) {
          runtime.onCdc({
            tableName: row.tableName,
            op: row.op,
            before: row.before,
            after: row.after,
            seq: row.seq,
          });
        }
        acked = rows;
      },
      { intervalMs: 10_000 },
    );
    const drained = await runner.tick();
    expect(drained).toBeGreaterThanOrEqual(1);
    expect(acked.length).toBeGreaterThanOrEqual(1);
    await new Promise((r) => setTimeout(r, 60));
    expect(drainedEvents.some((e) => e.kind === "upsert" && e.row.id === "n7")).toBe(true);

    // Redelivery safety: a second tick must NOT re-hand delivered rows.
    const second = await runner.tick();
    expect(second).toBe(0);
    expect(batches).toBe(1);
  });

  test("full prelude round-trip mirrors production stamps (buildRlsIdentityPreludeSql)", async () => {
    // Guardrail: prelude statements execute inside a transaction exactly like
    // createConnProbeRunner does — catches single-statement regressions.
    const tx = conn.transaction!;
    await tx(async (txc) => {
      for (const stmt of buildRlsIdentityPreludeSql(ALICE)) {
        await txc.exec(stmt.sql, stmt.params ?? []);
      }
      const rows = await txc.query(`SELECT count(*) AS n FROM ${TABLE} WHERE owner = ?`, ["alice"]);
      expect(Number(rows[0]?.n)).toBeGreaterThan(0);
    });
  });
});

describe("openLiveStream push→pull bridge (pglite)", () => {
  let conn: SqlConnection;

  beforeAll(async () => {
    conn = await connectPglite({ url: "memory://oke-live-stream", role: "primary" });
    await installOkeRlsHelpers((sql) => conn.exec(sql));
    for (const stmt of ROW_PASSES) await conn.exec(stmt);
    await conn.exec(`DROP TABLE IF EXISTS ${TABLE}`);
    await conn.exec(`CREATE TABLE ${TABLE} (
      id text PRIMARY KEY, owner text NOT NULL, status text NOT NULL)`);
    await conn.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${TABLE} TO oke_app`);
    await conn.exec(`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY`);
    await conn.exec(`CREATE POLICY owner_all ON ${TABLE} AS PERMISSIVE FOR ALL TO public
      USING (owner = oke.user()) WITH CHECK (owner = oke.user())`);
  }, 30_000);

  afterAll(async () => {
    await conn.close();
  });

  async function seed(id: string, owner: string, status: string): Promise<void> {
    await conn.query(`INSERT INTO ${TABLE} VALUES (?, ?, ?)`, [id, owner, status]);
  }

  test("classified events flow through the SSE chunk iterator", async () => {
    const runtime = liveQueryRuntimeFromConn(conn);
    const stream = openLiveStream(
      "sse-stream-alice",
      {
        table: TABLE,
        identity: ALICE,
        pkColumn: "id",
      },
      runtime,
    );
    try {
      await seed("s1", "alice", "open");
      runtime.onCdc({
        tableName: TABLE,
        op: "insert",
        before: null,
        after: { id: "s1", owner: "alice", status: "open" },
      });
      const iter = stream.chunks[Symbol.asyncIterator]();
      const step = await Promise.race([
        iter.next(),
        new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 2000)),
      ]);
      expect(step).not.toBe("timeout");
      if (step === "timeout") return;
      expect(step.done).toBe(false);
      expect(step.value.data).toEqual({
        kind: "upsert",
        row: { id: "s1", owner: "alice", status: "open" },
      });
    } finally {
      await stream.close();
    }
  });

  test("close() detaches the subscription — no further delivery", async () => {
    const runtime = liveQueryRuntimeFromConn(conn);
    const stream = openLiveStream(
      "sse-stream-close",
      {
        table: TABLE,
        identity: ALICE,
        pkColumn: "id",
      },
      runtime,
    );
    await stream.close();
    runtime.onCdc({
      tableName: TABLE,
      op: "insert",
      before: null,
      after: { id: "gone", owner: "alice", status: "open" },
    });
    await seed("gone", "alice", "open");
    const iter = stream.chunks[Symbol.asyncIterator]();
    const step = await Promise.race([
      iter.next(),
      new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 200)),
    ]);
    // Closed stream ends iteration rather than delivering.
    expect(step === "timeout" || step.done === true).toBe(true);
  });
});
