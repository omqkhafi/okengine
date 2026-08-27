/**
 * LiveQuery runtime classification + bounded fan-out pool.
 *
 * Probes are scripted BY SQL SHAPE (EXISTS vs policy replay vs window
 * predicate), matching how classifyForSubscriber actually queries. The RLS
 * truthfulness of those probes is proven separately by the parity gate.
 */

import { describe, expect, test } from "bun:test";
import {
  classifyForSubscriber,
  identityBucket,
  LiveQueryRuntime,
  type CdcEventInput,
  type LiveProbeExec,
  type LiveProbeRunner,
  type LiveSubscription,
} from "./live-query-runtime.ts";
import type { RlsIdentity } from "../../drivers/pg-rls.ts";

const ALICE: RlsIdentity = { gate: "member", userId: "alice", scopes: ["member"] };

/** Script probe answers by SQL inspection (row_passes / EXISTS / custom). */
function shapeProbes(answerFor: (sql: string) => boolean): LiveProbeRunner {
  return {
    async runStamped(_identity, fn) {
      const exec: LiveProbeExec = {
        async query(sql) {
          return answerFor(sql) ? [{ ok: true }] : [];
        },
      };
      return fn(exec);
    },
  };
}

function sub(overrides: Partial<LiveSubscription> = {}): LiveSubscription {
  return {
    id: "s1",
    ref: "sql:app",
    table: "tasks",
    pkColumn: "id",
    identity: ALICE,
    deliver() {},
    ...overrides,
  };
}

const isReplay = (sql: string): boolean => sql.includes("row_passes_policies");
const isWindow = (sql: string): boolean => sql.includes("before_row");

describe("classification algorithm (stateless)", () => {
  test("insert visible → upsert", async () => {
    const after = { id: "a", status: "open" };
    const event: CdcEventInput = { tableName: "tasks", op: "insert", before: null, after };
    const out = await classifyForSubscriber(
      shapeProbes((sql) => !isReplay(sql)),
      sub(),
      event,
    );
    expect(out).toEqual({ kind: "upsert", row: after });
  });

  test("update still visible → upsert", async () => {
    const event: CdcEventInput = {
      tableName: "tasks",
      op: "update",
      before: { id: "a", status: "todo" },
      after: { id: "a", status: "open" },
    };
    const out = await classifyForSubscriber(
      shapeProbes((sql) => !isReplay(sql)),
      sub(),
      event,
    );
    expect(out).toEqual({ kind: "upsert", row: { id: "a", status: "open" } });
  });

  test("delete of previously-visible row → delete", async () => {
    const event: CdcEventInput = {
      tableName: "tasks",
      op: "delete",
      before: { id: "a", status: "open" },
      after: null,
    };
    // Replay on before image says it WAS visible → delete.
    const out = await classifyForSubscriber(shapeProbes(isReplay), sub(), event);
    expect(out).toEqual({ kind: "delete", id: "a" });
  });

  test("delete of never-visible row → ignore", async () => {
    const event: CdcEventInput = {
      tableName: "tasks",
      op: "delete",
      before: { id: "z" },
      after: null,
    };
    const out = await classifyForSubscriber(
      shapeProbes(() => false),
      sub(),
      event,
    );
    expect(out).toBeNull();
  });

  test("insert of invisible row → ignore (no state, no delete)", async () => {
    const event: CdcEventInput = {
      tableName: "tasks",
      op: "insert",
      before: null,
      after: { id: "x", status: "closed" },
    };
    const out = await classifyForSubscriber(
      shapeProbes(() => false),
      sub(),
      event,
    );
    expect(out).toBeNull();
  });

  test("query-window exit → revoked reason query", async () => {
    const event: CdcEventInput = {
      tableName: "tasks",
      op: "update",
      before: { id: "a", status: "open" },
      after: { id: "a", status: "closed" },
    };
    // EXISTS(after)=false; before replay=true; before-window predicate=
    // matched (uses before_row table); after replay=allowed ⇒ query exit.
    const out = await classifyForSubscriber(
      shapeProbes((sql) => isReplay(sql) || isWindow(sql)),
      sub({ whereSql: "status = 'open'" }),
      event,
    );
    expect(out).toEqual({ kind: "revoked", id: "a", reason: "query" });
  });

  test("RLS revocation → revoked reason rls", async () => {
    const event: CdcEventInput = {
      tableName: "tasks",
      op: "update",
      before: { id: "a", owner: "alice" },
      after: { id: "a", owner: "mallory" },
    };
    // Sequence: EXISTS(after)=false → replay(BEFORE)=true → replay(AFTER)=false.
    // Keyed on call ordinal since replay SQL text is identical (params differ).
    let replayCalls = 0;
    const out = await classifyForSubscriber(
      {
        async runStamped(_identity, fn) {
          return fn({
            async query(sql) {
              if (sql.includes("row_passes_policies")) {
                replayCalls += 1;
                return [{ ok: replayCalls === 1 }];
              }
              return []; // EXISTS after-image: invisible
            },
          });
        },
      },
      sub(),
      event,
    );
    expect(replayCalls).toBe(2);
    expect(out).toEqual({ kind: "revoked", id: "a", reason: "rls" });
  });

  test("never visible in any world → ignore entirely", async () => {
    const event: CdcEventInput = {
      tableName: "tasks",
      op: "update",
      before: { id: "z", owner: "mallory" },
      after: { id: "z", owner: "mallory2" },
    };
    const out = await classifyForSubscriber(
      shapeProbes(() => false),
      sub(),
      event,
    );
    expect(out).toBeNull();
  });
});

describe("bounded fan-out pool (architecture contract)", () => {
  function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  test("concurrency cap never exceeded; queue drains in waves", async () => {
    let inflight = 0;
    let peak = 0;
    const gate = deferred<void>();
    const runtime = new LiveQueryRuntime(
      {
        async runStamped(_identity, fn) {
          inflight += 1;
          peak = Math.max(peak, inflight);
          await gate.promise;
          try {
            return fn({
              async query() {
                return [{ ok: true }];
              },
            });
          } finally {
            inflight -= 1;
          }
        },
      },
      { concurrency: 4 },
    );
    runtime.subscribe(sub({ id: "all" }));
    for (let i = 0; i < 12; i += 1) {
      runtime.onCdc({ tableName: "tasks", op: "insert", before: null, after: { id: `r${i}` } });
    }
    await new Promise((r) => setTimeout(r, 10));
    expect(runtime.queueDepth).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(4);
    gate.resolve();
    await new Promise((r) => setTimeout(r, 20));
    expect(runtime.queueDepth).toBe(0);
    expect(runtime.metrics.checkFailures).toBe(0);
  });

  test("shed on overflow increments eventsShed — never unbounded growth", async () => {
    const gate = deferred<void>();
    const runtime = new LiveQueryRuntime(
      {
        async runStamped(_i, fn) {
          await gate.promise;
          return fn({
            async query() {
              return [];
            },
          });
        },
      },
      { concurrency: 1, maxQueue: 2 },
    );
    runtime.subscribe(sub({ id: "one" }));
    for (let i = 0; i < 10; i += 1) {
      runtime.onCdc({ tableName: "tasks", op: "insert", before: null, after: { id: `r${i}` } });
    }
    expect(runtime.metrics.eventsShed).toBeGreaterThan(0);
    gate.resolve();
  });

  test("probe failures count as checkFailures and skip delivery", async () => {
    const delivered: unknown[] = [];
    const runtime = new LiveQueryRuntime({
      async runStamped() {
        throw new Error("stamp broken");
      },
    });
    runtime.subscribe(
      sub({
        id: "broke",
        deliver(e) {
          delivered.push(e);
        },
      }),
    );
    runtime.onCdc({ tableName: "tasks", op: "update", before: { id: "a" }, after: { id: "a" } });
    await new Promise((r) => setTimeout(r, 20));
    expect(delivered).toHaveLength(0);
    expect(runtime.metrics.checkFailures).toBe(1);
  });

  test("unsubscriber removes target — later CDC events ignored", async () => {
    const delivered: unknown[] = [];
    const runtime = new LiveQueryRuntime(shapeProbes(() => true) as LiveProbeRunner & object);
    const off = runtime.subscribe(
      sub({
        id: "t1",
        deliver(e) {
          delivered.push(e);
        },
      }),
    );
    off();
    expect(runtime.size).toBe(0);
    runtime.onCdc({ tableName: "tasks", op: "insert", before: null, after: { id: "a" } });
    await new Promise((r) => setTimeout(r, 10));
    expect(delivered).toHaveLength(0);
    expect(runtime.metrics.eventsIn).toBe(1);
  });

  test("mutationId echoes onto upsert events", async () => {
    const delivered: Extract<
      Awaited<ReturnType<typeof classifyForSubscriber>>,
      { kind?: string }
    >[] = [];
    const runtime = new LiveQueryRuntime(shapeProbes((sql) => !isReplay(sql)));
    runtime.subscribe(
      sub({
        id: "mut",
        deliver(e) {
          delivered.push(e);
        },
      }),
    );
    runtime.onCdc({
      tableName: "tasks",
      op: "update",
      before: { id: "a" },
      after: { id: "a", done: true },
      mutationId: "m-123",
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(delivered[0]).toMatchObject({ kind: "upsert", mutationId: "m-123" });
  });

  test("identity buckets group identical stamps (v2 dedupe prep)", () => {
    expect(identityBucket(ALICE)).toBe(identityBucket({ ...ALICE }));
    expect(identityBucket(ALICE)).not.toBe(identityBucket({ ...ALICE, userId: "bob" }));
    expect(identityBucket({ ...ALICE, tenantId: "acme" })).not.toBe(identityBucket(ALICE));
  });
});
