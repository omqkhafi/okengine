/**
 * Gate element acceptance:
 * - five rate strategies pass a concurrency test
 * - Module:Action pairs derived from the Manifest
 * - policy evaluation order
 */

import { describe, expect, test } from "bun:test";
import { memoryKvDriver } from "../drivers/memory.ts";
import { createRedisFakeClient, redisDriver } from "../drivers/redis.ts";
import type { Manifest } from "../manifest/types.ts";
import {
  ALL_RATE_STRATEGIES,
  assertHttpGatePosture,
  createGateRuntime,
  deriveModuleActions,
  formatGatesList,
  gate,
  GateBootError,
  takeRate,
} from "./gate.ts";

describe("gate declaration", () => {
  test("policy and rate shapes", () => {
    const member = gate.policy("member", ({ auth }) => !!auth.verified);
    expect(member.kind).toBe("policy");
    expect(member.name).toBe("member");

    const fair = gate.rate({
      strategy: "sliding-window-counter",
      max: 60,
      per: "1m",
      keyBy: "ip",
    });
    expect(fair.kind).toBe("rate");
    expect(fair.name).toBe("rate:sliding-window-counter:60/1m");
    expect(fair.strategy).toBe("sliding-window-counter");
  });

  test("scope is sugar over policy with auth.scopes.has(name)", async () => {
    const canBook = gate.scope("booking:create");
    expect(canBook.kind).toBe("policy");
    expect(canBook.name).toBe("booking:create");
    expect(canBook.scopes).toEqual(["booking:create"]);
    expect(
      await canBook.check({
        auth: { userId: "u1", scopes: new Set(["booking:create"]), verified: true },
        operator: { id: null },
      }),
    ).toBe(true);
    expect(
      await canBook.check({
        auth: { userId: "u1", scopes: new Set(), verified: true },
        operator: { id: null },
      }),
    ).toBe(false);
  });

  test("public sentinel always allows and reserves the name", async () => {
    expect(gate.public.name).toBe("public");
    expect(await gate.public.check({ auth: { userId: null, scopes: new Set() }, operator: { id: null } })).toBe(
      true,
    );
    expect(() => gate.policy("public", () => true)).toThrow(/reserved/);
    expect(() => gate.scope("public")).toThrow(/reserved/);
  });

  test("defaults strategy to sliding-window-counter", () => {
    const r = gate.rate({ max: 10, per: "1s" });
    expect(r.strategy).toBe("sliding-window-counter");
  });
});

describe("Module:Action derivation", () => {
  test("pairs come from Manifest flows — never hand-written", () => {
    const manifest: Manifest = {
      oke: "1.0",
      app: "skyport",
      flows: {
        "bookings.create": {
          plane: "user",
          gates: ["booking:create"],
          effects: { writes: ["sql:bookings"] },
        },
        "console.store.query": {
          plane: "operator",
        },
      },
      gates: {
        member: { kind: "policy" },
      },
    };
    const pairs = deriveModuleActions(manifest);
    expect(pairs).toContain("bookings:create");
    expect(pairs).toContain("booking:create");
    expect(pairs).toContain("console:store.query");
    expect(pairs).toContain("store.sql:write");
    expect(pairs).toContain("pii:reveal");
    expect(pairs).toContain("console:flows:invoke-as");
    expect(formatGatesList(pairs)).toContain("bookings:create");
  });
});

describe("five rate strategies — concurrency", () => {
  for (const strategy of ALL_RATE_STRATEGIES) {
    test(`${strategy} never exceeds max under concurrent takes`, async () => {
      const kv = await memoryKvDriver.open({ name: `rate-${strategy}` });
      const max = 20;
      const windowMs = 60_000;
      const subject = "user-1";
      const nowMs = 1_000_000;

      const results = await Promise.all(
        Array.from({ length: 100 }, () =>
          takeRate(kv, { strategy, max, windowMs, subject, nowMs }),
        ),
      );

      const allowed = results.filter((r) => r.allowed).length;
      expect(allowed).toBe(max);
      expect(results.filter((r) => !r.allowed).length).toBe(100 - max);
      await kv.close();
    });
  }

  test("redis fake EVAL matches memory for sliding-window-counter", async () => {
    const client = createRedisFakeClient(() => 1_000_000);
    const kv = await redisDriver.open({
      name: "rate-redis",
      client,
      nowMs: () => 1_000_000,
    });
    const max = 5;
    let allowed = 0;
    for (let i = 0; i < 10; i++) {
      const r = await takeRate(kv, {
        strategy: "sliding-window-counter",
        max,
        windowMs: 60_000,
        subject: "ip",
        nowMs: 1_000_000,
      });
      if (r.allowed) allowed++;
    }
    expect(allowed).toBe(max);
    await kv.close();
  });
});

describe("gate boot posture", () => {
  const unguarded = [
    {
      trigger: { kind: "http" as const, method: "GET", path: "/health", gates: [] as const },
      flow: { name: "health.ping" },
    },
  ];

  test("GateBootError lists every unguarded HTTP trigger", () => {
    expect(() =>
      assertHttpGatePosture([
        ...unguarded,
        {
          trigger: { kind: "http", method: "POST", path: "/x", gates: [gate.public] },
          flow: { name: "x.public" },
        },
      ]),
    ).toThrow(GateBootError);
  });

  test("unguardedHttp allow skips audit only when env is test", () => {
    expect(() =>
      assertHttpGatePosture(unguarded, { unguardedHttp: "allow", env: "test" }),
    ).not.toThrow();
  });

  test("unguardedHttp allow has no effect outside env === test", () => {
    for (const env of ["local", "prod", "docker"] as const) {
      expect(() =>
        assertHttpGatePosture(unguarded, { unguardedHttp: "allow", env }),
      ).toThrow(GateBootError);
    }
  });
});

describe("gate runtime", () => {
  test("policy then rate — evaluation order", async () => {
    const kv = await memoryKvDriver.open({ name: "gate-rt" });
    const member = gate.policy("member", ({ auth }) => !!auth.verified);
    const fair = gate.rate({ max: 2, per: "1m", keyBy: "user" });
    const rt = createGateRuntime({
      gates: [member, fair],
      kv,
      now: () => 5_000,
    });

    const denied = await rt.check(["member", fair.name], {
      auth: { userId: "u1", scopes: new Set(), verified: false },
      operator: { id: null },
    });
    expect(denied[0]?.allowed).toBe(false);
    expect(denied).toHaveLength(1);

    const ok = await rt.allow(["member", fair.name], {
      auth: { userId: "u1", scopes: new Set(), verified: true },
      operator: { id: null },
    });
    expect(ok).toBe(true);
    await kv.close();
  });
});
