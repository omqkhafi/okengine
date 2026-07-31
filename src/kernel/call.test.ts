import { describe, expect, test, beforeEach } from "bun:test";
import { oke } from "./app.ts";
import { flow, resetFlowSeq } from "./flow.ts";
import { on, resetBindings } from "./on.ts";
import { http } from "./triggers.ts";

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
});

describe("fx.call — untriggered flows", () => {
  test("untriggered flow is callable via app.call and fx.call", async () => {
    const stats = flow({
      name: "links.stats",
      do: ({ code }: { code: string }) => ({ code, clicks: 7 }),
    });

    const parent = on(
      http.post("/run"),
      flow({
        name: "links.run",
        effects: { calls: ["links.stats"] },
        do: async ({ code }: { code: string }, fx) => {
          const result = await fx.call("links.stats", { code });
          return result;
        },
      }),
    );

    const app = oke({ autoBoot: false, name: "call" }).adopt(stats);

    // Direct call (Linkly ⑤)
    await expect(app.call(stats, { code: "sa" })).resolves.toEqual({
      code: "sa",
      clicks: 7,
    });

    // Same path through fx.call from a triggered flow
    const res = await app.fetch(
      new Request("http://localhost/run", {
        method: "POST",
        body: JSON.stringify({ code: "sa" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { code: "sa", clicks: 7 },
      error: null,
    });
    expect(parent.triggers).toHaveLength(1);
    expect(stats.triggers).toHaveLength(0);
  });

  test("fx.call propagates fx.principal without filling fx.auth", async () => {
    const audit = flow({
      name: "audit.log",
      do: (_input: { event: string }, fx) => ({
        authUserId: fx.auth.userId,
        principalUserId: fx.principal.userId,
        principalScopes: [...fx.principal.scopes],
      }),
    });

    const act = on(
      http.post("/act"),
      flow({
        name: "act",
        effects: { calls: ["audit.log"] },
        do: async (_input: Record<string, never>, fx) => {
          return fx.call("audit.log", { event: "act" });
        },
      }),
    );

    const app = oke({
      autoBoot: false,
      name: "principal-call",
      gate: { unguardedHttp: "allow" },
    }).adopt(audit);
    await app.boot({ env: "test", unguardedHttp: "allow" });

    const result = await app.execute(act, {}, act.$trigger ?? act.triggers[0]!, {
      principal: {
        userId: "user-1",
        scopes: ["booking:create"],
        verified: true,
      },
    });

    expect(result.failure).toBeUndefined();
    expect(result.output).toEqual({
      authUserId: null,
      principalUserId: "user-1",
      principalScopes: ["booking:create"],
    });
  });

  test("http and signal invocations of the same flow execute identically", async () => {
    let runs = 0;
    const work = flow({
      name: "work",
      do: (input: { v: number }) => {
        runs += 1;
        return { out: input.v + 1 };
      },
    });

    on(http.post("/work"), work);
    on({ name: "tick", delivery: "broadcast" }, work);

    const app = oke({ autoBoot: false, name: "identical" });

    const a = await app.fetch(
      new Request("http://localhost/work", {
        method: "POST",
        body: JSON.stringify({ v: 10 }),
      }),
    );
    const b = await app.dispatchSignal("tick", { v: 10 });

    expect(await a.json()).toEqual({ data: { out: 11 }, error: null });
    expect(b[0]?.output).toEqual({ out: 11 });
    expect(runs).toBe(2);
  });
});
