/**
 * Two consumers, one bus: postgres SKIP LOCKED and redis consumer groups.
 */

import { describe, expect, test } from "bun:test";
import { startupRedisUrl } from "../test/reset-element-registries.ts";
import { signal } from "../elements/signal.ts";
import {
  openPostgresChannelLedger,
  type ChannelLedgerSql,
} from "../elements/channel/sql-ledger.ts";
import { createPostgresSignalFake, openPostgresSignal } from "./signal-postgres.ts";
import {
  createBunSignalRedisClient,
  createSignalRedisFake,
  openRedisSignal,
  SIGNAL_REDIS_MIN_IDLE_MS,
} from "./signal-redis.ts";

/** Process-start URL. A suite that deletes `REDIS_URL` must not skip this file. */
const redisUrlAtLoad = startupRedisUrl();

function decls(name: string, retries = 3) {
  const decl = signal.once(name, { retries, deadLetter: true });
  return new Map([[decl.name, decl]]);
}

describe("postgres signal competing consumers", () => {
  test("one message is delivered once across two buses", async () => {
    const sql = createPostgresSignalFake();
    const name = "order-placed";
    const a = await openPostgresSignal({ signals: decls(name), sql });
    const b = await openPostgresSignal({ signals: decls(name), sql });
    const got: string[] = [];
    await a.subscribe(name, "a", async () => {
      got.push("a");
    });
    await b.subscribe(name, "b", async () => {
      got.push("b");
    });
    await a.emit(name, { id: "1" });
    await Bun.sleep(5);
    await a.drain();
    await b.drain();
    expect(got).toHaveLength(1);
    await a.close();
    await b.close();
  });
});

describe("redis streams competing consumers", () => {
  test("one message is delivered once across two groups", async () => {
    const redis = createSignalRedisFake();
    const name = "order-placed";
    const shared = { signals: decls(name), redis, compete: true as const };
    const a = await openRedisSignal({ ...shared, consumerId: "a" });
    const b = await openRedisSignal({ ...shared, consumerId: "b" });
    const got: string[] = [];
    await a.subscribe(name, "a", async () => {
      got.push("a");
    });
    await b.subscribe(name, "b", async () => {
      got.push("b");
    });
    await a.emit(name, { id: "1" });
    await a.drain();
    await b.drain();
    expect(got).toHaveLength(1);
    await a.close();
    await b.close();
  });

  test("a failed handler leaves the entry pending for redelivery", async () => {
    const redis = createSignalRedisFake();
    const name = "flaky";
    const bus = await openRedisSignal({
      signals: decls(name, 2),
      redis,
      compete: true,
      consumerId: "a",
    });
    let calls = 0;
    await bus.subscribe(name, "a", async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
    });
    await bus.emit(name, { id: "1" });
    await bus.drain();
    expect(calls).toBe(1);
    await bus.drain();
    expect(calls).toBe(2);
    await bus.close();
  });

  test("another consumer reclaims an unacked entry", async () => {
    let nowMs = 0;
    const now = () => nowMs;
    const redis = createSignalRedisFake({ now });
    const name = "handoff";
    const shared = { signals: decls(name, 3), redis, compete: true as const, now };
    const a = await openRedisSignal({ ...shared, consumerId: "a" });
    const b = await openRedisSignal({ ...shared, consumerId: "b" });
    let aCalls = 0;
    const got: string[] = [];
    await a.subscribe(name, "a", async () => {
      aCalls += 1;
      throw new Error("down");
    });
    await b.subscribe(name, "b", async () => {
      got.push("b");
    });
    await a.emit(name, { id: "1" });
    await a.drain();
    nowMs += SIGNAL_REDIS_MIN_IDLE_MS;
    await b.drain();
    expect(aCalls).toBe(1);
    expect(got).toEqual(["b"]);
    await a.close();
    await b.close();
  });

  test.skipIf(!redisUrlAtLoad)("REDIS_URL: two clients ack once", async () => {
    const url = redisUrlAtLoad;
    const name = `oke-compete-${Date.now()}`;
    const redisA = createBunSignalRedisClient(url);
    const redisB = createBunSignalRedisClient(url);
    const a = await openRedisSignal({
      signals: decls(name),
      redis: redisA,
      compete: true,
      consumerId: "a",
    });
    const b = await openRedisSignal({
      signals: decls(name),
      redis: redisB,
      compete: true,
      consumerId: "b",
    });
    const got: string[] = [];
    await a.subscribe(name, "a", async () => {
      got.push("a");
    });
    await b.subscribe(name, "b", async () => {
      got.push("b");
    });
    await a.emit(name, { id: "1" });
    await a.drain();
    await b.drain();
    expect(got).toHaveLength(1);
    await a.close();
    await b.close();
  });
});

function memoryLedgerSql(): ChannelLedgerSql {
  const consent = new Map<string, { subject: string; medium: string; at: number }>();
  const bounce = new Map<string, { subject: string; medium: string; at: number }>();
  const receipts = new Map<string, string>();

  function pair(params: readonly unknown[]): string {
    return `${String(params[0])}\0${String(params[1])}`;
  }

  return {
    async query(sql) {
      if (sql.includes("oke_channel_consent")) {
        return [...consent.values()];
      }
      if (sql.includes("oke_channel_bounce")) {
        return [...bounce.values()];
      }
      if (sql.includes("oke_channel_receipt")) {
        return [...receipts.entries()].map(([id, body]) => ({ id, body }));
      }
      return [];
    },
    async exec(sql, params = []) {
      if (sql.startsWith("CREATE")) return { changes: 0 };
      if (sql.includes("INSERT INTO oke_channel_consent")) {
        consent.set(pair(params), {
          subject: String(params[0]),
          medium: String(params[1]),
          at: Number(params[2]),
        });
        return { changes: 1 };
      }
      if (sql.includes("DELETE FROM oke_channel_consent")) {
        consent.delete(pair(params));
        return { changes: 1 };
      }
      if (sql.includes("INSERT INTO oke_channel_bounce")) {
        bounce.set(pair(params), {
          subject: String(params[0]),
          medium: String(params[1]),
          at: Number(params[2]),
        });
        return { changes: 1 };
      }
      if (sql.includes("DELETE FROM oke_channel_bounce")) {
        bounce.delete(pair(params));
        return { changes: 1 };
      }
      if (sql.includes("INSERT INTO oke_channel_receipt")) {
        receipts.set(String(params[0]), String(params[1]));
        return { changes: 1 };
      }
      if (sql.includes("UPDATE oke_channel_receipt")) {
        receipts.set(String(params[1]), String(params[0]));
        return { changes: 1 };
      }
      return { changes: 0 };
    },
  };
}

describe("channel ledger across instances", () => {
  test("consent and suppression written on A are visible to B", async () => {
    const sql = memoryLedgerSql();
    const a = await openPostgresChannelLedger(sql);
    const b = await openPostgresChannelLedger(sql);
    a.suppression.optOut("a@b.c", "email");
    a.suppression.addPriorBounce("c@d.e", "sms");
    a.receipts.record({
      id: "r1",
      template: "note",
      to: "a@b.c",
      medium: "email",
      status: "sent",
      attempts: [],
      at: 1,
    });
    await a.flush();
    await b.reload();
    expect(b.consent.isOptedOut("a@b.c", "email")).toBe(true);
    expect(b.suppression.isSuppressed("c@d.e", "sms")).toEqual({
      suppressed: true,
      reason: "prior-bounce",
    });
    expect(b.receipts.all()).toHaveLength(1);
    expect(b.receipts.all()[0]?.id).toBe("r1");
  });
});
