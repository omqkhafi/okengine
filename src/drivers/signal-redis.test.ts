/**
 * Redis signal driver — stream reply parsing, reclaim, and pub/sub fan-out.
 */

import { describe, expect, test } from "bun:test";
import { signal } from "../elements/signal.ts";
import type { SignalDecl } from "../elements/signal/declare.ts";
import {
  createSignalRedisFake,
  openRedisSignal,
  parseXreadgroupReply,
  SIGNAL_REDIS_MIN_IDLE_MS,
} from "./signal-redis.ts";

const entryFields = ["payload", '{"a":1}', "signal", "order"] as const;

describe("parseXreadgroupReply", () => {
  test("reads Bun object replies and RESP arrays for XREADGROUP and XAUTOCLAIM", () => {
    const expected = [{ id: "1-0", fields: { payload: '{"a":1}', signal: "order" } }];
    const entries = [["1-0", [...entryFields]]];

    expect(parseXreadgroupReply({ "oke:signal:order": entries })).toEqual(expected);
    expect(parseXreadgroupReply([["oke:signal:order", entries]])).toEqual(expected);
    expect(parseXreadgroupReply(["0-0", entries, []])).toEqual(expected);
    expect(parseXreadgroupReply(null)).toEqual([]);
    expect(parseXreadgroupReply({})).toEqual([]);
  });
});

function onceDecl(name: string, retries: number): Map<string, SignalDecl> {
  const decl = signal.once(name, { retries, deadLetter: true });
  return new Map([[decl.name, decl]]);
}

describe("redis once reclaim", () => {
  test("a pending entry past min-idle is delivered once", async () => {
    let nowMs = 0;
    const now = () => nowMs;
    const redis = createSignalRedisFake({ now });
    const name = "stuck-pending";
    const shared = { signals: onceDecl(name, 3), redis, compete: true as const, now };
    const a = await openRedisSignal({ ...shared, consumerId: "a" });
    const b = await openRedisSignal({ ...shared, consumerId: "b" });
    let aCalls = 0;
    const got: string[] = [];
    await a.subscribe(name, "a", async () => {
      aCalls += 1;
      throw new Error("stuck");
    });
    await b.subscribe(name, "b", async () => {
      got.push("b");
    });
    await a.emit(name, { id: "1" });
    await a.drain();
    expect(aCalls).toBe(1);
    await b.drain();
    expect(got).toEqual([]);
    nowMs += SIGNAL_REDIS_MIN_IDLE_MS;
    await b.drain();
    expect(got).toEqual(["b"]);
    await a.drain();
    await b.drain();
    expect(aCalls).toBe(1);
    expect(got).toEqual(["b"]);
    await a.close();
    await b.close();
  });

  test("a slow handler whose idle is reset is not stolen", async () => {
    let nowMs = 0;
    const now = () => nowMs;
    const redis = createSignalRedisFake({ now });
    const name = "slow-handler";
    const shared = { signals: onceDecl(name, 3), redis, compete: true as const, now };
    const a = await openRedisSignal({ ...shared, consumerId: "a" });
    const b = await openRedisSignal({ ...shared, consumerId: "b" });
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = (): void => {};
    const startedP = new Promise<void>((resolve) => {
      started = resolve;
    });
    let calls = 0;
    const stolen: string[] = [];
    await a.subscribe(name, "a", async () => {
      calls += 1;
      started();
      await gate;
    });
    await b.subscribe(name, "b", async () => {
      stolen.push("b");
    });
    await a.emit(name, { id: "1" });
    const draining = a.drain();
    await startedP;
    await a.drain();
    expect(calls).toBe(1);
    nowMs += SIGNAL_REDIS_MIN_IDLE_MS;
    await redis.flushIdle();
    nowMs += SIGNAL_REDIS_MIN_IDLE_MS - 1;
    await b.drain();
    expect(stolen).toEqual([]);
    expect(calls).toBe(1);
    release();
    await draining;
    await a.close();
    await b.close();
  });

  test("retries 2 dead-letters after exactly 3 runs across reclaim", async () => {
    let nowMs = 0;
    const now = () => nowMs;
    const redis = createSignalRedisFake({ now });
    const name = "always-fail";
    const shared = { signals: onceDecl(name, 2), redis, compete: true as const, now };
    const a = await openRedisSignal({ ...shared, consumerId: "a" });
    const b = await openRedisSignal({ ...shared, consumerId: "b" });
    let calls = 0;
    const fail = async (): Promise<void> => {
      calls += 1;
      throw new Error("nope");
    };
    await a.subscribe(name, "a", fail);
    await b.subscribe(name, "b", fail);
    await a.emit(name, { id: "1" });
    await a.drain();
    expect(calls).toBe(1);
    nowMs += SIGNAL_REDIS_MIN_IDLE_MS;
    await b.drain();
    expect(calls).toBe(2);
    nowMs += SIGNAL_REDIS_MIN_IDLE_MS;
    await a.drain();
    expect(calls).toBe(3);
    const dead = await a.deadLetters(name);
    expect(dead).toHaveLength(1);
    expect(dead[0]?.attempts).toBe(3);
    nowMs += SIGNAL_REDIS_MIN_IDLE_MS;
    await b.drain();
    expect(calls).toBe(3);
    await a.close();
    await b.close();
  });
});

describe("redis broadcast and live", () => {
  test("delivers another origin, skips own origin, and accepts a legacy payload", async () => {
    const redis = createSignalRedisFake();
    const name = "news-relay";
    const decl = signal.broadcast(name, { optional: true });
    const bus = await openRedisSignal({
      signals: new Map([[decl.name, decl]]),
      redis,
      consumerId: "self",
    });
    const got: unknown[] = [];
    await bus.subscribe(name, "sub", async (msg) => {
      got.push(msg.payload);
    });

    await redis.publish(
      `oke:signal:bcast:${name}`,
      JSON.stringify({ __oke_env: 1, id: "m-other", origin: "other", payload: { n: 1 } }),
    );
    expect(got).toEqual([{ n: 1 }]);

    await redis.publish(
      `oke:signal:bcast:${name}`,
      JSON.stringify({ __oke_env: 1, id: "m-self", origin: "self", payload: { n: 2 } }),
    );
    expect(got).toEqual([{ n: 1 }]);

    await redis.publish(`oke:signal:bcast:${name}`, JSON.stringify({ n: 3 }));
    expect(got).toEqual([{ n: 1 }, { n: 3 }]);

    await bus.emit(name, { n: 4 });
    await bus.drain();
    expect(got).toEqual([{ n: 1 }, { n: 3 }, { n: 4 }]);
    const last = redis.published.at(-1);
    expect(last?.channel).toBe(`oke:signal:bcast:${name}`);
    expect(JSON.parse(last?.message ?? "null")).toMatchObject({
      __oke_env: 1,
      origin: "self",
      payload: { n: 4 },
    });
    await bus.close();
  });

  test("live pubsub delivers another origin and a legacy payload, and skips own origin", async () => {
    const redis = createSignalRedisFake();
    const name = "seat-relay";
    const decl = signal.live(name, { optional: true });
    const bus = await openRedisSignal({
      signals: new Map([[decl.name, decl]]),
      redis,
      consumerId: "self",
    });
    const iter = bus.live(name)[Symbol.asyncIterator]();
    const pending = iter.next();
    await Bun.sleep(0);

    await redis.publish(
      `oke:signal:live:${name}`,
      JSON.stringify({ __oke_env: 1, id: "live-other", origin: "other", payload: { n: 1 } }),
    );
    const first = await pending;
    expect(first.done).toBe(false);
    if (!first.done) expect(first.value).toEqual({ id: "live-other", payload: { n: 1 } });

    const skipped = iter.next();
    await redis.publish(
      `oke:signal:live:${name}`,
      JSON.stringify({ __oke_env: 1, id: "live-self", origin: "self", payload: { n: 2 } }),
    );
    await redis.publish(`oke:signal:live:${name}`, JSON.stringify({ n: 3 }));
    const third = await skipped;
    expect(third.done).toBe(false);
    if (!third.done) expect(third.value.payload).toEqual({ n: 3 });

    await iter.return?.();
    await bus.close();
  });
});
