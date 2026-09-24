/**
 * HTTP idempotency — claim, replay, lease reclaim, and the client timeout path.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { createClient } from "../client/create.ts";
import type { AppOf } from "../client/types.ts";
import {
  createPostgresJournalFake,
  createPostgresJournalStore,
} from "../drivers/journal-postgres.ts";
import { gate } from "../elements/gate.ts";
import { store } from "../elements/store.ts";
import { oke, type OkeApp } from "./app.ts";
import { flow, resetFlowSeq, type AnyFlowDef } from "./flow.ts";
import { createMemoryJournalStore, type JournalStore } from "./journal.ts";
import type { JournalRuntime } from "./boot-bind/journal.ts";
import type { Binding } from "./on.ts";
import { resetBindings } from "./on.ts";
import { decideClaim, IDEMPOTENCY_LEASE_MS } from "./idempotency-store.ts";
import { http } from "./triggers.ts";

const KEY = "idem-key-0123456789";

const apps: OkeApp[] = [];

afterEach(async () => {
  resetBindings();
  resetFlowSeq();
  for (const app of apps) await app.bootResult?.close();
  apps.length = 0;
});

function journalOf(store: JournalStore, leaseMs = IDEMPOTENCY_LEASE_MS): JournalRuntime {
  return { store, instanceId: "idem-test", leaseMs, driverId: "memory" };
}

async function start(
  name: string,
  bindings: readonly Binding[],
  journal?: JournalRuntime,
  stores?: ReturnType<typeof store.kv>[],
  policies?: ReturnType<typeof gate.policy>[],
): Promise<OkeApp> {
  resetBindings();
  resetFlowSeq();
  const app = oke({
    name,
    env: "test",
    registry: "ignore",
    gate: {
      unguardedHttp: "allow",
      ...(policies !== undefined ? { policies } : {}),
    },
    bindings: [...bindings],
    ...(stores !== undefined ? { stores } : {}),
    ...(journal !== undefined ? { elements: { journal } } : {}),
  });
  await app.boot({ env: "test", ...(policies !== undefined ? { gates: policies } : {}) });
  apps.push(app);
  return app;
}

function chargeBinding(run: () => Promise<{ n: number }> | { n: number }): Binding {
  return {
    trigger: http.post("/charge", { in: z.object({ n: z.number() }) }),
    flow: flow("pay.charge", {
      effects: { writes: ["sql:payments"] },
      do: async () => run(),
    }) as AnyFlowDef,
  };
}

function post(body: unknown, key: string | false = KEY): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (key !== false) headers.set("idempotency-key", key);
  return new Request("http://localhost/charge", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("idempotency store", () => {
  test("a live same-key claim is busy; a different payload mismatches", () => {
    const scope = { tenant: "", principal: "anon", flow: "pay.charge", key: KEY };
    const row = {
      ...scope,
      fingerprint: "aaa",
      status: "in_progress" as const,
      claimToken: "t1",
      leaseExpiresAt: 2_000,
      createdAt: 0,
      expiresAt: 9_000,
    };
    const input = {
      scope,
      fingerprint: "aaa",
      claimToken: "t2",
      now: 1_000,
      leaseMs: 30_000,
      ttlMs: 1,
    };
    expect(decideClaim(row, input, new Set(["t1"])).op).toBe("busy");
    expect(decideClaim(row, { ...input, fingerprint: "bbb" }, new Set()).op).toBe("mismatch");
    expect(decideClaim({ ...row, leaseExpiresAt: 0 }, input, new Set()).op).toBe("reclaim");
  }, 30_000);

  test("postgres fake replays one claim and rejects a second payload", async () => {
    const journal = await createPostgresJournalStore({ sql: createPostgresJournalFake() });
    const idem = journal.idempotency!;
    const scope = { tenant: "", principal: "anon", flow: "pay.charge", key: KEY };
    const first = await idem.claim({
      scope,
      fingerprint: "aaa",
      claimToken: "t1",
      now: 1_000,
      leaseMs: 30_000,
      ttlMs: 5_000,
    });
    expect(first.kind).toBe("claimed");
    await idem.complete(scope, "t1", { status: 200, body: "{\"data\":1}" });
    const again = await idem.claim({
      scope,
      fingerprint: "aaa",
      claimToken: "t2",
      now: 1_100,
      leaseMs: 30_000,
      ttlMs: 5_000,
    });
    expect(again.kind).toBe("replay");
    const reused = await idem.claim({
      scope,
      fingerprint: "bbb",
      claimToken: "t3",
      now: 1_100,
      leaseMs: 30_000,
      ttlMs: 5_000,
    });
    expect(reused.kind).toBe("mismatch");
  }, 30_000);
});

describe("HTTP idempotency", () => {
  test("the same key runs once and the second response is a replay", async () => {
    let runs = 0;
    const app = await start("idem-replay", [
      chargeBinding(() => {
        runs += 1;
        return { n: runs };
      }),
    ]);
    const first = await app.fetch(post({ n: 1 }));
    const second = await app.fetch(post({ n: 1 }));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    expect(await second.json()).toEqual(await first.json());
    expect(runs).toBe(1);
  }, 30_000);

  test("two concurrent same-key requests: one runs, the other is 409", async () => {
    let runs = 0;
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = await start("idem-race", [
      chargeBinding(async () => {
        runs += 1;
        await hold;
        return { n: 1 };
      }),
    ]);
    const pending = Promise.all([
      app.fetch(post({ n: 1 })).then(async (res) => {
        if (res.status === 409) release();
        return res;
      }),
      app.fetch(post({ n: 1 })).then(async (res) => {
        if (res.status === 409) release();
        return res;
      }),
    ]);
    const [a, b] = await pending;
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const conflict = a.status === 409 ? a : b;
    expect(((await conflict.json()) as { error: { code: string } }).error.code).toBe(
      "IdempotencyInProgress",
    );
    expect(runs).toBe(1);
  }, 30_000);

  test("the same key with a different payload is 422", async () => {
    const app = await start("idem-reuse", [chargeBinding(() => ({ n: 1 }))]);
    expect((await app.fetch(post({ n: 1 }))).status).toBe(200);
    const reused = await app.fetch(post({ n: 2 }));
    expect(reused.status).toBe(422);
    expect(((await reused.json()) as { error: { code: string } }).error.code).toBe(
      "IdempotencyKeyReused",
    );
  }, 30_000);

  test("a validation or gate rejection stores nothing; the same key then succeeds", async () => {
    let runs = 0;
    const member = gate.policy("member", ({ auth }) => auth.verified === true);
    const charge = flow("pay.charge", {
      effects: { writes: ["sql:payments"] },
      do: () => {
        runs += 1;
        return { n: 1 };
      },
    }) as AnyFlowDef;
    charge.in = z.object({ n: z.number() });
    const binding: Binding = {
      trigger: http.post("/charge").gate(member),
      flow: charge,
    };
    const app = await start("idem-gate", [binding], undefined, undefined, [member]);
    const invalid = await app.fetch(post({ n: "nope" }));
    expect(invalid.status).toBe(422);
    const denied = await app.fetch(post({ n: 1 }));
    expect(denied.status).toBe(401);
    const allowed = await app.execute(
      binding.flow,
      { n: 1 },
      binding.trigger,
      {
        request: post({ n: 1 }),
        validated: true,
        principal: { plane: "user", userId: "u1", scopes: new Set(), verified: true },
      },
    );
    expect(allowed.failure).toBeUndefined();
    expect(allowed.output).toEqual({ n: 1 });
    expect(runs).toBe(1);
  }, 30_000);

  test("a throw before any mutation deletes the row; a throw after a write replays 500", async () => {
    let early = 0;
    const earlyApp = await start("idem-early", [
      chargeBinding(() => {
        early += 1;
        throw new Error("before");
      }),
    ]);
    expect((await earlyApp.fetch(post({ n: 1 }))).status).toBe(500);
    const earlyRetry = await earlyApp.fetch(post({ n: 1 }));
    expect(earlyRetry.status).toBe(500);
    expect(earlyRetry.headers.get("idempotent-replayed")).toBeNull();
    expect(early).toBe(2);

    const box = store.kv("box");
    let writes = 0;
    const lateApp = await start(
      "idem-late",
      [
        {
          trigger: http.post("/charge", { in: z.object({ n: z.number() }) }),
          flow: flow("pay.charge", {
            effects: { writes: ["kv:box"] },
            do: async (_input, fx) => {
              writes += 1;
              await fx.store(box).set("k", "v");
              throw new Error("after");
            },
          }) as AnyFlowDef,
        },
      ],
      undefined,
      [box],
    );
    const first = await lateApp.fetch(post({ n: 1 }));
    const second = await lateApp.fetch(post({ n: 1 }));
    expect(first.status).toBe(500);
    expect(second.status).toBe(500);
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    expect(writes).toBe(1);
  }, 30_000);

  test("a forfeited lease re-executes a non-durable flow and resumes a durable one", async () => {
    const memory = createMemoryJournalStore();
    let runs = 0;
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const plain = await start(
      "idem-reclaim",
      [
        chargeBinding(async () => {
          runs += 1;
          await hold;
          return { n: runs };
        }),
      ],
      journalOf(memory, 80),
    );
    const first = plain.fetch(post({ n: 1 }));
    expect(await waitFor(() => runs === 1)).toBe(true);
    const row = await memory.idempotency!.read({
      tenant: "",
      principal: "anon",
      flow: "pay.charge",
      key: KEY,
    });
    expect(row?.status).toBe("in_progress");
    expect(await memory.idempotency!.forfeit(row!, row!.claimToken)).toBe(true);
    const second = plain.fetch(post({ n: 1 }));
    expect(await waitFor(() => runs === 2)).toBe(true);
    release();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);

    const durableStore = createMemoryJournalStore();
    const step1: string[] = [];
    const blockers: Array<() => void> = [];
    const durable = await start(
      "idem-durable",
      [
        {
          trigger: http.post("/charge", { in: z.object({ n: z.number() }) }),
          flow: flow("pay.charge", {
            durable: true,
            effects: { writes: ["sql:payments"] },
            do: async (_input, fx) => {
              await fx.step("create-intent", () => {
                step1.push("step1");
                return { id: "pi_1" };
              });
              await fx.step("mid-flight", async () => {
                await new Promise<void>((resolve) => {
                  blockers.push(resolve);
                });
                return "done";
              });
              return { n: 1 };
            },
          }) as AnyFlowDef,
        },
      ],
      journalOf(durableStore, 80),
    );
    const hung = durable.fetch(post({ n: 1 }));
    expect(await waitFor(() => blockers.length === 1)).toBe(true);
    const held = await durableStore.idempotency!.read({
      tenant: "",
      principal: "anon",
      flow: "pay.charge",
      key: KEY,
    });
    expect(await durableStore.idempotency!.forfeit(held!, held!.claimToken)).toBe(true);
    await Bun.sleep(120);
    const resumed = durable.fetch(post({ n: 1 }));
    expect(await waitFor(() => blockers.length === 2)).toBe(true);
    expect(step1).toEqual(["step1"]);
    blockers[0]!();
    blockers[1]!();
    expect((await hung).status).toBe(200);
    expect((await resumed).status).toBe(200);
    expect(step1).toEqual(["step1"]);
  }, 30_000);

  test("an expired ttl runs again; streams and reads ignore the key; required demands it", async () => {
    let runs = 0;
    const ttlApp = await start("idem-ttl", [
      {
        trigger: http.post("/charge", { in: z.object({ n: z.number() }) }),
        flow: flow("pay.charge", {
          effects: { writes: ["sql:payments"] },
          idempotency: { ttl: "1ms" },
          do: () => {
            runs += 1;
            return { n: runs };
          },
        }) as AnyFlowDef,
      },
    ]);
    expect((await ttlApp.fetch(post({ n: 1 }))).status).toBe(200);
    await Bun.sleep(20);
    expect((await ttlApp.fetch(post({ n: 1 }))).status).toBe(200);
    expect(runs).toBe(2);

    let reads = 0;
    const readApp = await start("idem-read", [
      {
        trigger: http.get("/charge"),
        flow: flow("pay.read", {
          effects: { reads: ["sql:payments"] },
          cache: false,
          do: () => {
            reads += 1;
            return { n: reads };
          },
        }) as AnyFlowDef,
      },
    ]);
    const get = () =>
      new Request("http://localhost/charge", { headers: { "idempotency-key": KEY } });
    await readApp.fetch(get());
    await readApp.fetch(get());
    expect(reads).toBe(2);

    let streamed = 0;
    const streamApp = await start("idem-stream", [
      {
        trigger: http.post("/charge", { in: z.object({ n: z.number() }) }),
        flow: flow("pay.charge", {
          stream: true,
          effects: { writes: ["sql:payments"] },
          do: () => {
            streamed += 1;
            return { n: streamed };
          },
        }) as AnyFlowDef,
      },
    ]);
    await streamApp.fetch(post({ n: 1 }));
    await streamApp.fetch(post({ n: 1 }));
    expect(streamed).toBe(2);

    let requiredRuns = 0;
    const requiredApp = await start("idem-required", [
      {
        trigger: http.post("/charge", { in: z.object({ n: z.number() }) }),
        flow: flow("pay.charge", {
          effects: { writes: ["sql:payments"] },
          idempotency: "required",
          do: () => {
            requiredRuns += 1;
            return { n: 1 };
          },
        }) as AnyFlowDef,
      },
    ]);
    const missing = await requiredApp.fetch(post({ n: 1 }, false));
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe(
      "IdempotencyKeyMissing",
    );
    expect(requiredRuns).toBe(0);
    const bad = await requiredApp.fetch(post({ n: 1 }, "short"));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe(
      "IdempotencyKeyInvalid",
    );
  }, 30_000);

  test("two principals with the same key are two records", async () => {
    let runs = 0;
    const binding = chargeBinding(() => {
      runs += 1;
      return { n: runs };
    });
    const memory = createMemoryJournalStore();
    const app = await start("idem-principals", [binding], journalOf(memory));
    const call = (userId: string) =>
      app.execute(binding.flow, { n: 1 }, binding.trigger, {
        request: post({ n: 1 }),
        validated: true,
        principal: { plane: "user", userId, scopes: new Set(), verified: true },
      });
    expect((await call("a")).output).toEqual({ n: 1 });
    expect((await call("b")).output).toEqual({ n: 2 });
    expect(runs).toBe(2);
    expect(
      await memory.idempotency!.read({
        tenant: "",
        principal: "user:a",
        flow: "pay.charge",
        key: KEY,
      }),
    ).toBeDefined();
    expect(
      await memory.idempotency!.read({
        tenant: "",
        principal: "user:b",
        flow: "pay.charge",
        key: KEY,
      }),
    ).toBeDefined();
  }, 30_000);

  test("a client timeout leaves do running, then a 409 waits and the replay arrives", async () => {
    let runs = 0;
    let aborted = 0;
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const memory = createMemoryJournalStore();
    const app = await start(
      "idem-timeout",
      [
        {
          trigger: http.post("/charge", { in: z.object({ n: z.number() }) }),
          flow: flow("pay.charge", {
            effects: { writes: ["sql:payments"] },
            do: async (_input, fx) => {
              runs += 1;
              if (fx.signal.aborted) aborted += 1;
              fx.signal.addEventListener("abort", () => {
                aborted += 1;
              });
              await hold;
              return { ok: true as const };
            },
          }) as AnyFlowDef,
        },
      ],
      journalOf(memory, 400),
    );
    type PayApp = AppOf<{
      pay: {
        charge: { in: { n: number }; out: { ok: true }; errors: Record<string, never> };
      };
    }>;
    const api = createClient<PayApp>("http://localhost", {
      retry: { retries: 2, delay: 1, backoff: 1 },
      timeout: 300,
      routes: { "pay.charge": { method: "POST", path: "/charge" } },
      fetch: (input, init) => {
        const pending = app.fetch(new Request(input, init));
        const signal = init?.signal;
        if (signal === undefined) return pending;
        return new Promise((resolve, reject) => {
          pending.then((res) => {
            if (res.status === 409) release();
            resolve(res);
          }, reject);
          if (signal.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      },
    });
    const result = await api.pay.charge({ n: 1 });
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ ok: true });
    expect(result.meta?.idempotentReplayed).toBe(true);
    expect(runs).toBe(1);
    expect(aborted).toBe(0);
  }, 30_000);
});

async function waitFor(cond: () => boolean, timeoutMs = 2_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await Bun.sleep(10);
  }
  return cond();
}
