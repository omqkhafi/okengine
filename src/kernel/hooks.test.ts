import { describe, expect, test, beforeEach } from "bun:test";
import { oke } from "./app.ts";
import { fail } from "./errors.ts";
import { flow, resetFlowSeq } from "./flow.ts";
import { HOOK_STAGES, mergeHooks } from "./hooks.ts";
import { on, resetBindings } from "./on.ts";
import { http } from "./triggers.ts";

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
});

describe("hooks — order and composition", () => {
  test("documented stage list", () => {
    expect(HOOK_STAGES).toEqual([
      "onRequest",
      "onParse",
      "onAuth",
      "beforeHandle",
      "afterHandle",
      "onError",
      "onResponse",
    ]);
  });

  test("mergeHooks is app → unit → flow, registration order within", () => {
    const order: string[] = [];
    const mark =
      (label: string) =>
      () => {
        order.push(label);
      };

    const merged = mergeHooks(
      { onRequest: [mark("app1"), mark("app2")] },
      { onRequest: [mark("unit1")] },
      { onRequest: [mark("flow1")] },
    );

    for (const fn of merged.onRequest ?? []) {
      void fn(
        {
          trigger: { kind: "internal" },
          flow: flow({ name: "x", do: () => undefined }),
          input: undefined,
          params: {},
          state: {},
          decorations: {},
        },
        // fx unused
        null as never,
      );
    }

    expect(order).toEqual(["app1", "app2", "unit1", "flow1"]);
  });

  test("pipeline fires stages in order around the handler", async () => {
    const order: string[] = [];

    const f = flow({
      name: "ordered",
      unit: "links",
      do: () => {
        order.push("handler");
        return { ok: true };
      },
    }).hook("beforeHandle", () => {
      order.push("flow:beforeHandle");
    }).hook("afterHandle", () => {
      order.push("flow:afterHandle");
    });

    on(http.get("/ordered"), f);

    const app = oke({ name: "hooks-order" })
      .hook("onRequest", () => {
        order.push("app:onRequest");
      })
      .hook("onParse", () => {
        order.push("app:onParse");
      })
      .hook("onAuth", () => {
        order.push("app:onAuth");
      })
      .hook("beforeHandle", () => {
        order.push("app:beforeHandle");
      })
      .hook("afterHandle", () => {
        order.push("app:afterHandle");
      })
      .hook("onResponse", () => {
        order.push("app:onResponse");
      });

    app.unit("links").hook("beforeHandle", () => {
      order.push("unit:beforeHandle");
    });

    await app.fetch(new Request("http://localhost/ordered"));

    expect(order).toEqual([
      "app:onRequest",
      "app:onParse",
      "app:onAuth",
      "app:beforeHandle",
      "unit:beforeHandle",
      "flow:beforeHandle",
      "handler",
      "app:afterHandle",
      "flow:afterHandle",
      "app:onResponse",
    ]);
  });

  test("hook short-circuits with Response and skips handler", async () => {
    const order: string[] = [];

    on(
      http.get("/sc"),
      flow({
        name: "sc",
        do: () => {
          order.push("handler");
          return { ok: true };
        },
      }),
    );

    const app = oke({ name: "sc-res" })
      .hook("onAuth", () => {
        order.push("onAuth");
        return new Response("denied", { status: 401 });
      })
      .hook("beforeHandle", () => {
        order.push("beforeHandle");
      })
      .hook("onResponse", () => {
        order.push("onResponse");
      });

    const res = await app.fetch(new Request("http://localhost/sc"));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("denied");
    expect(order).toEqual(["onAuth", "onResponse"]);
  });

  test("hook short-circuits with FlowFailure and runs onError", async () => {
    const order: string[] = [];

    on(
      http.get("/fail"),
      flow({
        name: "fail-flow",
        do: () => {
          order.push("handler");
        },
      }),
    );

    const app = oke({ name: "sc-err" })
      .hook("beforeHandle", () => {
        order.push("beforeHandle");
        return fail("Nope", {});
      })
      .hook("onError", () => {
        order.push("onError");
      })
      .hook("afterHandle", () => {
        order.push("afterHandle");
      })
      .hook("onResponse", () => {
        order.push("onResponse");
      });

    const res = await app.fetch(new Request("http://localhost/fail"));
    expect(res.status).toBe(400);
    expect(order).toEqual(["beforeHandle", "onError", "onResponse"]);
  });
});
