import { describe, expect, test, beforeEach } from "bun:test";
import { oke } from "./app.ts";
import { flow, isFlow, resetFlowSeq } from "./flow.ts";
import { on, resetBindings } from "./on.ts";
import { every, http, internal, table } from "./triggers.ts";

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
});

describe("flow — one species", () => {
  test("flow() returns a branded FlowDef", () => {
    const f = flow({
      name: "ping",
      do: () => ({ ok: true }),
    });
    expect(isFlow(f)).toBe(true);
    expect(f.name).toBe("ping");
    expect(f.triggers).toEqual([]);
    expect(f.durable).toBe(false);
  });

  test("on() returns the same flow object and records the trigger", () => {
    const f = flow({ name: "create", do: () => 1 });
    const bound = on(http.post("/notes"), f);
    // Same runtime object; trigger stamp is type-only so identities differ at the type level.
    expect(bound as object).toBe(f);
    expect(f.triggers).toHaveLength(1);
    expect(f.triggers[0]?.kind).toBe("http");
    expect(bound.$trigger?.kind).toBe("http");
  });

  test("the same flow object is reachable from HTTP and signal triggers", async () => {
    const calls: string[] = [];
    const shared = flow({
      name: "shared.work",
      do: (input: { n: number }) => {
        calls.push(`n=${input.n}`);
        return { n: input.n * 2 };
      },
    });

    const signal = { name: "order-placed", delivery: "once" as const };
    on(http.post("/work"), shared);
    on(signal, shared);

    const app = oke({ name: "one-species" });
    expect(app.bindings).toHaveLength(2);
    expect(app.bindings[0]?.flow).toBe(shared);
    expect(app.bindings[1]?.flow).toBe(shared);

    const httpResult = await app.execute(shared, { n: 3 }, shared.triggers[0]!);
    const signalResults = await app.dispatchSignal("order-placed", { n: 4 });

    expect(httpResult.output).toEqual({ n: 6 });
    expect(signalResults[0]?.output).toEqual({ n: 8 });
    expect(calls).toEqual(["n=3", "n=4"]);
  });
});

describe("five trigger kinds", () => {
  test("http · every · signal · table.changed · internal", async () => {
    const seen: string[] = [];

    const httpFlow = on(
      http.get("/:code"),
      flow({
        name: "t.http",
        do: ({ code }: { code: string }) => {
          seen.push(`http:${code}`);
          return { code };
        },
      }),
    );

    on(
      every("1h"),
      flow({
        name: "t.every",
        do: () => {
          seen.push("every");
        },
      }),
    );

    on(
      { name: "link-clicked", delivery: "once" },
      flow({
        name: "t.signal",
        do: ({ code }: { code: string }) => {
          seen.push(`signal:${code}`);
        },
      }),
    );

    on(
      table("orders").changed("status"),
      flow({
        name: "t.cdc",
        do: (p: { before: { status: string }; after: { status: string } }) => {
          seen.push(`cdc:${p.before.status}->${p.after.status}`);
        },
      }),
    );

    on(
      internal,
      flow({
        name: "t.internal",
        do: () => {
          seen.push("internal");
          return { ok: true };
        },
      }),
    );

    const app = oke({ name: "five" });

    const res = await app.fetch(new Request("http://localhost/abc", { method: "GET" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { code: "abc" }, error: null });

    await app.dispatchEvery("1h");
    await app.dispatchSignal("link-clicked", { code: "sa" });
    await app.dispatchCdc(
      "orders",
      {
        before: { status: "open" },
        after: { status: "paid" },
      },
      "status",
    );

    const internalResult = await app.call("t.internal");
    expect(internalResult).toEqual({ ok: true });

    expect(seen).toEqual(["http:abc", "every", "signal:sa", "cdc:open->paid", "internal"]);
    expect(httpFlow.triggers[0]?.kind).toBe("http");
  });
});
