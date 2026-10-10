/**
 * Bun.SQL affected-row shapes. An empty UPDATE array carries `count`,
 * not `changes`. Each exec wrapper must read that count.
 */

import { describe, expect, test } from "bun:test";

import { signalPgFromClient } from "../bench/lib/signal-pg.ts";
import { asChannelSql } from "../kernel/boot-bind/channel.ts";
import { asSignalSql } from "../kernel/boot-bind/signal.ts";
import { affectedRows } from "./affected-rows.ts";
import { createPostgresCronStore, type BunCronClient } from "./clock-postgres.ts";
import { createPostgresInstanceStore, type BunInstanceClient } from "./instances-postgres.ts";
import { createPostgresJournalStore, type BunJournalClient } from "./journal-postgres.ts";
import { connectPostgres, type PostgresClientLike, type PostgresQueryResult } from "./postgres.ts";

const MODES = ["count", "affectedRows", "changes"] as const;

type Mode = (typeof MODES)[number];

/**
 * Real Bun.SQL DML result: an empty array plus one affected-row field.
 *
 * @param mode - Which field carries the count
 * @param n - Affected rows
 */
function bunDml(mode: Mode, n: number): PostgresQueryResult {
  const rows: PostgresQueryResult = [];
  if (mode === "count") return Object.assign(rows, { count: n });
  if (mode === "affectedRows") return Object.assign(rows, { affectedRows: n });
  return Object.assign(rows, { changes: n });
}

function bunClient(mode: Mode, n: number): PostgresClientLike {
  const client: PostgresClientLike = {
    async unsafe() {
      return bunDml(mode, n);
    },
    async begin(fn) {
      return fn(client);
    },
    async reserve() {
      return Object.assign(client, {
        release() {
          /* stub */
        },
      });
    },
    async close() {},
  };
  return client;
}

describe("affectedRows", () => {
  test("prefers count, then affectedRows, then changes, then length", () => {
    expect(affectedRows(Object.assign([], { count: 2, affectedRows: 9, changes: 8 }))).toBe(2);
    expect(affectedRows(Object.assign([], { affectedRows: 3, changes: 8 }))).toBe(3);
    expect(affectedRows(Object.assign([], { changes: 4 }))).toBe(4);
    expect(affectedRows([{ id: "a" }, { id: "b" }])).toBe(2);
    expect(affectedRows(null)).toBe(0);
  });
});

describe("postgres exec wrappers", () => {
  test("store exec reads each Bun shape", async () => {
    for (const mode of MODES) {
      const sql = await connectPostgres({ client: bunClient(mode, 2) });
      expect((await sql.exec("UPDATE t SET a = 1")).changes).toBe(2);
      await sql.close();
    }
  });

  test("journal exec reads each Bun shape", async () => {
    for (const mode of MODES) {
      const store = await createPostgresJournalStore({
        client: bunClient(mode, 2) as BunJournalClient,
      });
      expect((await store.sql.exec("UPDATE oke_journal_runs SET status = 'running'")).changes).toBe(
        2,
      );
      await store.close();
    }
  });

  test("clock exec reads each Bun shape", async () => {
    for (const mode of MODES) {
      const store = await createPostgresCronStore({
        client: bunClient(mode, 2) as BunCronClient,
      });
      expect((await store.sql.exec("UPDATE oke_crons SET status = 'active'")).changes).toBe(2);
      await store.close();
    }
  });

  test("instances exec reads each Bun shape", async () => {
    for (const mode of MODES) {
      const store = await createPostgresInstanceStore({
        client: bunClient(mode, 2) as BunInstanceClient,
      });
      expect((await store.sql.exec("UPDATE oke_instances SET env = 'dev'")).changes).toBe(2);
      await store.close?.();
    }
  });

  test("signal exec reads each Bun shape", async () => {
    for (const mode of MODES) {
      const sql = asSignalSql(bunClient(mode, 2));
      expect((await sql.exec("UPDATE oke_signal_messages SET status = 'pending'")).changes).toBe(2);
    }
  });

  test("channel ledger exec reads each Bun shape", async () => {
    for (const mode of MODES) {
      const sql = asChannelSql(bunClient(mode, 2));
      expect((await sql.exec("UPDATE oke_channel_receipt SET body = '{}'")).changes).toBe(2);
    }
  });

  test("bench signal exec reads each Bun shape", async () => {
    for (const mode of MODES) {
      const sql = signalPgFromClient(bunClient(mode, 2));
      expect((await sql.exec("UPDATE oke_signal_messages SET status = 'pending'")).changes).toBe(2);
    }
  });
});
