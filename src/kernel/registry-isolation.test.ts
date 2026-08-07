/**
 * Registry isolation — two `oke()` apps in one process must not share routes.
 *
 * This is the multi-app / future-`mount()` guarantee: constructing one app
 * can never pull another app's flows through the process-global `on()`
 * registry. Before the fix, `oke()` adopted the registry snapshot and left
 * it intact, so App B below silently served App A's `/a` route (leakage).
 * The default `registry: "consume"` mode drains the registry at construction.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { oke } from "./app.ts";
import { flow, resetFlowSeq } from "./flow.ts";
import { listBindings, on, resetBindings, type Binding } from "./on.ts";
import { http } from "./triggers.ts";

afterEach(() => {
  resetBindings();
  resetFlowSeq();
});

describe("registry isolation", () => {
  test("consume (default): App B does not serve App A routes", async () => {
    on(http.get("/a"), flow("app-a.ping", { do: () => "a" }));
    const appA = oke({ autoBoot: false, name: "app-a" });

    // No resetBindings() between the apps — the pre-fix leak scenario.
    on(http.get("/b"), flow("app-b.ping", { do: () => "b" }));
    const appB = oke({ autoBoot: false, name: "app-b" });

    // Pre-fix this was 200: App B adopted App A's leftover binding.
    expect((await appB.fetch(new Request("http://localhost/a"))).status).toBe(404);

    const own = await appB.fetch(new Request("http://localhost/b"));
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({ data: "b", error: null });

    // App A still serves its own route after App B was constructed.
    const stillA = await appA.fetch(new Request("http://localhost/a"));
    expect(stillA.status).toBe(200);
    expect(await stillA.json()).toEqual({ data: "a", error: null });

    // Consume drained the registry — nothing left for a third app.
    expect(listBindings()).toHaveLength(0);
  });

  test("keep: today's behavior — registry survives construction", async () => {
    on(http.get("/a"), flow("kept.ping", { do: () => "a" }));
    oke({ autoBoot: false, name: "app-a", registry: "keep" });
    expect(listBindings()).toHaveLength(1);

    const appB = oke({ autoBoot: false, name: "app-b", registry: "keep" });
    expect((await appB.fetch(new Request("http://localhost/a"))).status).toBe(200);
  });

  test("ignore: only options.bindings are served", async () => {
    on(http.get("/stray"), flow("stray.ping", { do: () => "stray" }));

    const onlyB: Binding = {
      trigger: http.get("/b"),
      flow: flow("only-b.ping", { do: () => "b" }),
    };
    const app = oke({ autoBoot: false, name: "app-b", registry: "ignore", bindings: [onlyB] });

    expect((await app.fetch(new Request("http://localhost/stray"))).status).toBe(404);

    const res = await app.fetch(new Request("http://localhost/b"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: "b", error: null });

    // Ignore never touches the registry.
    expect(listBindings()).toHaveLength(1);
  });
});
