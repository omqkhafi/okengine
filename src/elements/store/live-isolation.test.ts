/**
 * Cross-table event-isolation gate (Realtime Round 2):
 *
 * CDC capture is GLOBAL — every committed write on every table enters the
 * same sink → outbox → runtime ingest pipeline. This suite adversarially
 * proves a subscriber's stream stays confined to its own table:
 *
 *  1. Two RLS tables: `tasks`-shaped (subscribed, with a query window) and
 *     an `activity`-shaped table with NO live subscribers.
 *  2. Interleaved concurrent writes across BOTH tables while the tasks
 *     subscriber is live — direct sink dispatch AND batched outbox
 *     redelivery (the plausible leak path).
 *  3. Every delivered event must trace to a tasks-table row (id + payload),
 *     never an activity id — including no `revoked` events masquerading a
 *     cross-table leak. `checkFailures` must stay 0.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { connectPglite } from "../../drivers/pglite.ts";
import {
  installOkeRlsHelpers,
  ROW_PASSES_POLICIES_STATEMENTS as ROW_PASSES,
  type RlsIdentity,
} from "../../drivers/pg-rls.ts";
import { CdcOutbox, CdcOutboxRunner, type OutboxRow } from "../../drivers/cdc-outbox.ts";
import type { SqlConnection } from "../../drivers/types.ts";
import { liveQueryRuntimeFromConn } from "./live-query-server.ts";
import type { LiveQueryEvent } from "./live-query-runtime.ts";

const ALICE: RlsIdentity = { gate: "member", userId: "alice", scopes: ["member"] };
const TASKS = "oke_live_gate_tasks";
const ACTIVITY = "oke_live_gate_activity";

/** All delivered ids must belong to the tasks table, never activity. */
function assertIsolation(delivered: readonly LiveQueryEvent[]): void {
  for (const event of delivered) {
    if (event.kind === "upsert") {
      expect(TASK_EVENT_IDS.has(String((event.row as Record<string, unknown>).id))).toBe(true);
    } else {
      // revoked / delete — the id must still be a tasks id (a cross-table
      // leak masquerading as revoked/delete must fail here).
      expect(TASK_EVENT_IDS.has(String((event as { id: unknown }).id))).toBe(true);
    }
  }
}

/** The full task-id universe this suite ever writes. */
const TASK_EVENT_IDS = new Set(["t1", "t2", "t3", "t4"]);
/** Activity ids written adversarially — must never appear in any stream. */
const ACTIVITY_EVENT_IDS = ["a1", "a2", "a3", "a4", "a5", "a6"];

describe("cross-table live isolation (pglite, global CDC)", () => {
  let conn: SqlConnection;

  beforeAll(async () => {
    conn = await connectPglite({ url: "memory://oke-live-isolation", role: "primary" });
    await installOkeRlsHelpers((sql) => conn.exec(sql));
    for (const stmt of ROW_PASSES) await conn.exec(stmt);
    for (const table of [TASKS, ACTIVITY]) {
      await conn.exec(`DROP TABLE IF EXISTS ${table}`);
      await conn.exec(`CREATE TABLE ${table} (
        id text PRIMARY KEY, owner text NOT NULL, status text NOT NULL)`);
      await conn.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO oke_app`);
      await conn.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await conn.exec(`CREATE POLICY owner_all ON ${table} AS PERMISSIVE FOR ALL TO public
        USING (owner = oke.user()) WITH CHECK (owner = oke.user())`);
    }
  }, 30_000);

  afterAll(async () => {
    await conn.close();
  });

  async function seed(table: string, id: string, owner: string, status: string): Promise<void> {
    await conn.query(`INSERT INTO ${table} VALUES (?, ?, ?)`, [id, owner, status]);
  }

  test("interleaved concurrent multi-table writes — stream stays tasks-only", async () => {
    const runtime = liveQueryRuntimeFromConn(conn);
    const delivered: LiveQueryEvent[] = [];
    const unsub = runtime.subscribe({
      id: "sse-iso-tasks",
      ref: "sql:app",
      table: TASKS,
      pkColumn: "id",
      identity: ALICE,
      whereSql: `status = 'open'`,
      deliver(e) {
        delivered.push(e);
      },
    });
    try {
      // Overlapping tick work: every write below lands while the subscriber
      // is live and the shared ingest pipeline is busy on BOTH tables.
      await seed(TASKS, "t1", "alice", "open");
      await seed(ACTIVITY, "a1", "alice", "log");
      await seed(TASKS, "t2", "alice", "open");
      await seed(ACTIVITY, "a2", "alice", "log");
      await seed(TASKS, "t3", "alice", "open");
      await seed(ACTIVITY, "a3", "alice", "log");

      // Concurrent interleave — tasks and activity CDC events hit the shared
      // sink in the same ticks (Promise.all keeps them in-flight together).
      await Promise.all([
        conn.query(`UPDATE ${TASKS} SET status = 'done' WHERE id = 't2'`),
        conn.query(`INSERT INTO ${ACTIVITY} VALUES ('a4', 'alice', 'log')`),
        conn.query(`UPDATE ${TASKS} SET status = 'open' WHERE id = 't2'`),
        conn.query(`INSERT INTO ${ACTIVITY} VALUES ('a5', 'alice', 'log')`),
      ]);

      // Feed every committed change through the shared runtime ingest —
      // activity events ride the exact same pipeline as task events.
      runtime.onCdc({
        tableName: ACTIVITY,
        op: "insert",
        before: null,
        after: { id: "a4", owner: "alice", status: "log" },
      });
      runtime.onCdc({
        tableName: TASKS,
        op: "update",
        before: { id: "t2", owner: "alice", status: "done" },
        after: { id: "t2", owner: "alice", status: "open" },
      });
      runtime.onCdc({
        tableName: ACTIVITY,
        op: "update",
        before: { id: "a2", owner: "alice", status: "log" },
        after: { id: "a2", owner: "alice", status: "log2" },
      });
      runtime.onCdc({
        tableName: TASKS,
        op: "delete",
        before: { id: "t3", owner: "alice", status: "open" },
        after: null,
      });
      runtime.onCdc({
        tableName: ACTIVITY,
        op: "delete",
        before: { id: "a3", owner: "alice", status: "log" },
        after: null,
      });
      runtime.onCdc({
        tableName: ACTIVITY,
        op: "insert",
        before: null,
        after: { id: "a6", owner: "alice", status: "log" },
      });

      // t1 exits the query window — commit the heap change first (mirror
      // production ordering), then feed the CDC event.
      await conn.query(`UPDATE ${TASKS} SET status = 'done' WHERE id = 't1'`);
      runtime.onCdc({
        tableName: TASKS,
        op: "update",
        before: { id: "t1", owner: "alice", status: "open" },
        after: { id: "t1", owner: "alice", status: "done" },
      });

      await new Promise((r) => setTimeout(r, 80));
      assertIsolation(delivered);
      expect(delivered).toEqual([
        // t2 done→open (after-image re-enters window) → upsert;
        // t3 deleted → delete (ingest order);
        // t1 open→done exits the window → revoked(reason query).
        // Every activity event (a1–a6) absent — global CDC never leaks.
        { kind: "upsert", row: { id: "t2", owner: "alice", status: "open" } },
        { kind: "delete", id: "t3" },
        { kind: "revoked", id: "t1", reason: "query" },
      ]);
      expect(runtime.metrics.checkFailures).toBe(0);
    } finally {
      unsub();
    }
  });

  test("batched outbox redelivery with mixed tables — isolation survives replay", async () => {
    const outbox = new CdcOutbox(conn);
    await outbox.ensure();

    const runtime = liveQueryRuntimeFromConn(conn);
    const drainedEvents: LiveQueryEvent[] = [];
    runtime.subscribe({
      id: "sse-iso-poller",
      ref: "sql:app",
      table: TASKS,
      pkColumn: "id",
      identity: ALICE,
      whereSql: `status = 'open'`,
      deliver(e) {
        drainedEvents.push(e);
      },
    });

    // Another host committed these; a mixed batch (tasks + activity) drains
    // back through the shared runtime in one runner tick. Fresh ids — the
    // replay leg must not depend on test 1's rows.
    await seed(TASKS, "t4", "alice", "open");
    await seed(ACTIVITY, "b1", "alice", "log");
    await outbox.append({
      tableName: ACTIVITY,
      op: "insert",
      before: null,
      after: { id: "b1", owner: "alice", status: "log" },
    });
    await outbox.append({
      tableName: TASKS,
      op: "insert",
      before: null,
      after: { id: "t4", owner: "alice", status: "open" },
    });
    await outbox.append({
      tableName: ACTIVITY,
      op: "update",
      before: { id: "b1", owner: "alice", status: "log" },
      after: { id: "b1", owner: "alice", status: "log2" },
    });

    let batches = 0;
    const runner = new CdcOutboxRunner(
      outbox,
      async (rows: readonly OutboxRow[]) => {
        batches += 1;
        for (const row of rows) {
          runtime.onCdc({
            tableName: row.tableName,
            op: row.op,
            before: row.before,
            after: row.after,
            ...(Number.isFinite(row.seq) ? { seq: row.seq } : {}),
            ...(row.mutationId !== undefined ? { mutationId: row.mutationId } : {}),
          });
        }
      },
      { intervalMs: 10_000 },
    );
    const drained = await runner.tick();
    expect(drained).toBe(3);
    expect(batches).toBe(1);
    await new Promise((r) => setTimeout(r, 80));

    // Mixed batch: exactly one tasks event survives classification; the two
    // activity rows in the same batch never surface — no revoked, no upsert.
    // The replayed task event carries the outbox seq (round-trip stamp).
    expect(drainedEvents).toEqual([
      { kind: "upsert", row: { id: "t4", owner: "alice", status: "open" }, seq: 2 },
    ]);
    assertIsolation(drainedEvents);
    for (const id of ACTIVITY_EVENT_IDS) {
      expect(drainedEvents.some((e) => JSON.stringify(e).includes(id))).toBe(false);
    }
    await runner.stop?.();
  });

  test("activity-table subscriber sees only activity rows (symmetry control)", async () => {
    const runtime = liveQueryRuntimeFromConn(conn);
    const delivered: LiveQueryEvent[] = [];
    const unsub = runtime.subscribe({
      id: "sse-iso-activity",
      ref: "sql:app",
      table: ACTIVITY,
      pkColumn: "id",
      identity: ALICE,
      deliver(e) {
        delivered.push(e);
      },
    });
    try {
      await seed(ACTIVITY, "a9", "alice", "log");
      await seed(TASKS, "t9", "alice", "open");
      runtime.onCdc({
        tableName: ACTIVITY,
        op: "insert",
        before: null,
        after: { id: "a9", owner: "alice", status: "log" },
      });
      runtime.onCdc({
        tableName: TASKS,
        op: "insert",
        before: null,
        after: { id: "t9", owner: "alice", status: "open" },
      });
      await new Promise((r) => setTimeout(r, 80));
      expect(delivered).toEqual([
        { kind: "upsert", row: { id: "a9", owner: "alice", status: "log" } },
      ]);
    } finally {
      unsub();
    }
  });
});
