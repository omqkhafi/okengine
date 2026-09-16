import { describe, expect, test, beforeEach } from "bun:test";
import { oke } from "./app.ts";
import { fail } from "./fail-helpers.ts";
import { flow, resetFlowSeq } from "./flow.ts";
import { isFlowFailure } from "./hooks.ts";
import { on, resetBindings } from "./on.ts";
import { http } from "./triggers.ts";

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
});

describe("fx.call — untriggered flows", () => {
  test("untriggered flow is callable via app.call and fx.call", async () => {
    const stats = flow("links.stats", {
      do: ({ code }: { code: string }) => ({ code, clicks: 7 }),
    });

    const parent = on(
      http.post("/run"),
      flow("links.run", {
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
    const audit = flow("audit.log", {
      do: (_input: { event: string }, fx) => ({
        authUserId: fx.auth.userId,
        principalUserId: fx.principal.userId,
        principalScopes: [...fx.principal.scopes],
      }),
    });

    const act = on(
      http.post("/act"),
      flow("act", {
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
    const work = flow("work", {
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

describe("error pipeline — RPC / call propagation", () => {
  test("regression: unhandled RPC exception must never become 204 No Content", async () => {
    const boom = flow("math.boom", {
      do: () => {
        throw new Error("sensitive leak");
      },
    });
    const app = oke({ autoBoot: false, name: "rpc-boom" }).adopt(boom);

    const res = await app.fetch(
      new Request("http://localhost/_oke/math/boom", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );

    expect(res.status).toBe(500);
    expect(res.status).not.toBe(204);
    const body = (await res.json()) as {
      data: unknown;
      error: { code: string; data: unknown; message?: string };
    };
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("InternalError");
    expect(body.error.data).toEqual({});
    expect(body.error.message).toBe("Something went wrong. Try again.");
    expect(JSON.stringify(body)).not.toContain("sensitive leak");
  });

  test("RPC store auto-map unique violation is Conflict 409", async () => {
    const clash = flow("math.clash", {
      do: () => {
        throw Object.assign(new Error("duplicate key"), {
          code: "23505",
          constraint: "users_email_key",
        });
      },
    });
    const app = oke({ autoBoot: false, name: "rpc-clash" }).adopt(clash);

    const res = await app.fetch(
      new Request("http://localhost/_oke/math/clash", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("Conflict");
  });

  test("ExecuteResult.error is a derived projection of ctx.error", async () => {
    const boom = flow("math.boom", {
      do: () => {
        throw new Error("disk failed");
      },
    });
    const app = oke({ autoBoot: false, name: "exec-err" }).adopt(boom);
    const result = await app.execute(boom, {}, { kind: "internal" });

    expect(result.failure).toBeUndefined();
    expect(result.ctx.error).toBeDefined();
    expect(result.error).toBe(result.ctx.error);
  });

  test("app.call returns FlowFailure value for controlled fail", async () => {
    const missing = flow("notes.missing", {
      do: () => fail.notFound({ id: "1" }),
    });
    const app = oke({ autoBoot: false, name: "call-fail" }).adopt(missing);
    const out = await app.call(missing, {});
    expect(isFlowFailure(out)).toBe(true);
    if (isFlowFailure(out)) {
      expect(out.error.code).toBe("NotFound");
    }
  });

  test("app.call rethrows unhandled exception (never undefined)", async () => {
    const boom = flow("notes.boom", {
      do: () => {
        throw new Error("disk failed");
      },
    });
    const app = oke({ autoBoot: false, name: "call-throw" }).adopt(boom);
    await expect(app.call(boom, {})).rejects.toThrow("disk failed");
  });

  test("fx.call returns FlowFailure value for controlled fail", async () => {
    const child = flow("child.fail", {
      do: () => fail.notFound({ id: "x" }),
    });
    on(
      http.post("/run"),
      flow("parent.run", {
        effects: { calls: ["child.fail"] },
        do: async (_input: Record<string, never>, fx) => {
          const out = await fx.call("child.fail", {});
          expect(isFlowFailure(out)).toBe(true);
          return isFlowFailure(out) ? out : { unexpected: true };
        },
      }),
    );
    const app = oke({ autoBoot: false, name: "fx-fail" }).adopt(child);
    const res = await app.fetch(
      new Request("http://localhost/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NotFound");
  });

  test("fx.call rethrows when child throws", async () => {
    const child = flow("child.boom", {
      do: () => {
        throw new Error("worker crash");
      },
    });
    on(
      http.post("/run"),
      flow("parent.run", {
        effects: { calls: ["child.boom"] },
        do: async (_input: Record<string, never>, fx) => {
          return fx.call("child.boom", {});
        },
      }),
    );
    const app = oke({ autoBoot: false, name: "fx-throw" }).adopt(child);
    const res = await app.fetch(
      new Request("http://localhost/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { data: unknown; error: { code: string; message?: string } };
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("InternalError");
    expect(JSON.stringify(body)).not.toContain("worker crash");
  });

  test("nested fx.call chain propagates throw to outer boundary", async () => {
    const deep = flow("deep.boom", {
      do: () => {
        throw new Error("deep crash");
      },
    });
    const mid = flow("mid.call", {
      effects: { calls: ["deep.boom"] },
      do: async (_input: Record<string, never>, fx) => fx.call("deep.boom", {}),
    });
    on(
      http.post("/run"),
      flow("outer.run", {
        effects: { calls: ["mid.call"] },
        do: async (_input: Record<string, never>, fx) => fx.call("mid.call", {}),
      }),
    );
    const app = oke({ autoBoot: false, name: "nested-throw" }).adopt(deep).adopt(mid);
    const res = await app.fetch(
      new Request("http://localhost/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("InternalError");
    expect(JSON.stringify(body)).not.toContain("deep crash");
  });
});
