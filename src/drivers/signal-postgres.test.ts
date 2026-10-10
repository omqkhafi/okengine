/**
 * Postgres broadcast/live fan-out: shared table, per-instance cursor.
 */

import { describe, expect, test } from "bun:test";
import { signal } from "../elements/signal.ts";
import type { SignalDecl } from "../elements/signal/declare.ts";
import { asSignalSql } from "../kernel/boot-bind/signal.ts";
import {
  POSTGRES_SIGNAL_FANOUT_SQL,
  createPostgresSignalFake,
  openPostgresSignal,
  postgresSignalFakeBranches,
} from "./signal-postgres.ts";

const legacyInsert = `INSERT INTO oke_signal_messages (id, signal, payload, ordering_key, delivery, attempts, failures, created_at, available_at, status, locked_by, lease_expires_at, delivered_to, parent_run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

async function expectRejects(pending: Promise<unknown>, message: string): Promise<void> {
  let err: unknown;
  try {
    await pending;
  } catch (caught) {
    err = caught;
  }
  if (!(err instanceof Error)) {
    throw new Error("expected the statement to throw");
  }
  expect(err.message).toContain(message);
}

describe("postgres signal fake SQL branches", () => {
  test("an unmatched statement throws", async () => {
    const sql = createPostgresSignalFake();
    await expectRejects(sql.query("SELECT 1"), "unsupported query");
    await expectRejects(sql.exec("VACUUM oke_signal_messages"), "unsupported exec");
  });

  test("broadcast/live statements each hit exactly one branch", async () => {
    const sql = createPostgresSignalFake({ now: () => 4_200 });
    expect(postgresSignalFakeBranches(POSTGRES_SIGNAL_FANOUT_SQL.insert)).toEqual(["insert-db-at"]);
    expect(postgresSignalFakeBranches(POSTGRES_SIGNAL_FANOUT_SQL.poll)).toEqual(["fanout-poll"]);
    expect(postgresSignalFakeBranches(POSTGRES_SIGNAL_FANOUT_SQL.backfill)).toEqual([
      "backfill-db-at",
    ]);
    expect(postgresSignalFakeBranches(POSTGRES_SIGNAL_FANOUT_SQL.index)).toEqual([
      "index-delivery-db-at",
    ]);
    expect(postgresSignalFakeBranches(legacyInsert)).toEqual(["insert-message"]);

    await sql.exec(legacyInsert, [
      "old",
      "s",
      "null",
      null,
      "broadcast",
      0,
      "[]",
      50,
      50,
      "pending",
      null,
      null,
      "[]",
      null,
    ]);
    await sql.exec(POSTGRES_SIGNAL_FANOUT_SQL.backfill);
    await sql.exec(POSTGRES_SIGNAL_FANOUT_SQL.index);
    await sql.exec(POSTGRES_SIGNAL_FANOUT_SQL.insert, [
      "new",
      "s",
      "null",
      null,
      "broadcast",
      0,
      "[]",
      1,
      1,
      "pending",
      null,
      null,
      "[]",
      null,
    ]);

    const rows = await sql.query(POSTGRES_SIGNAL_FANOUT_SQL.poll, [0]);
    expect(rows.find((row) => row.id === "old")?.db_at).toBe(50);
    const fresh = rows.find((row) => row.id === "new");
    expect(fresh?.db_at).toBe(4_200);
    expect(fresh?.db_now).toBe(4_200);
  });
});

describe("postgres broadcast and live fan-out", () => {
  test("a broadcast and a live message on A reach B", async () => {
    const sql = createPostgresSignalFake();
    const news = signal.broadcast("news");
    const feed = signal.live("feed", { optional: true });
    const signals = new Map<string, SignalDecl>([
      [news.name, news],
      [feed.name, feed],
    ]);
    const a = await openPostgresSignal({ signals, sql });
    const b = await openPostgresSignal({ signals, sql });
    const got: string[] = [];
    await a.subscribe("news", "a", async () => {
      got.push("a");
    });
    await b.subscribe("news", "b", async () => {
      got.push("b");
    });

    const iterA = a.live("feed")[Symbol.asyncIterator]();
    const iterB = b.live("feed")[Symbol.asyncIterator]();
    const nextA = iterA.next();
    const nextB = iterB.next();
    await Bun.sleep(10);

    await a.emit("news", { id: "1" });
    await a.emit("feed", { n: 1 });
    await a.drain();
    await b.drain();

    expect(got.slice().sort()).toEqual(["a", "b"]);
    const [liveA, liveB] = await Promise.all([nextA, nextB]);
    expect(liveA.value?.payload).toEqual({ n: 1 });
    expect(liveB.value?.payload).toEqual({ n: 1 });
    await iterA.return?.();
    await iterB.return?.();
    await a.close();
    await b.close();
  });

  test("cursor starts at head so a row written before boot is not delivered", async () => {
    let t = 5_000;
    const sql = createPostgresSignalFake({ now: () => t });
    const news = signal.broadcast("news", { optional: true });
    const signals = new Map<string, SignalDecl>([[news.name, news]]);
    const writer = await openPostgresSignal({ signals, sql, lagMs: 30_000 });
    await writer.emit("news", { n: 1 });
    await writer.close();

    t = 6_000;
    const reader = await openPostgresSignal({ signals, sql, lagMs: 30_000 });
    const got: unknown[] = [];
    await reader.subscribe("news", "b", async (message) => {
      got.push(message.payload);
    });
    await reader.drain();
    expect(got).toEqual([]);
    await reader.close();
  });

  test("lagMs dedupes the same id across overlapping polls", async () => {
    let t = 10_000;
    const sql = createPostgresSignalFake({ now: () => t });
    const news = signal.broadcast("news");
    const signals = new Map<string, SignalDecl>([[news.name, news]]);
    const bus = await openPostgresSignal({ signals, sql, lagMs: 30_000 });
    const got: unknown[] = [];
    await bus.subscribe("news", "a", async (message) => {
      got.push(message.payload);
    });
    await bus.emit("news", { n: 1 });
    t = 15_000;
    await bus.drain();
    t = 20_000;
    await bus.drain();
    expect(got).toEqual([{ n: 1 }]);
    await bus.close();
  });

  test("a Bun UPDATE array with count and no changes is one affected row", async () => {
    const sql = asSignalSql({
      async unsafe() {
        return Object.assign([], { count: 1 });
      },
    });
    expect((await sql.exec("UPDATE oke_signal_messages SET status = 'pending'")).changes).toBe(1);
  });
});
