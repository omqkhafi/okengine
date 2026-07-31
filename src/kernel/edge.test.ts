/**
 * Plugin edge handlers — the contribution that answers HTTP requests no
 * flow owns (CORS preflight being the prime example), with the plain 404
 * preserved as the floor.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { oke } from "./app.ts";
import { flow, resetFlowSeq } from "./flow.ts";
import { on, resetBindings } from "./on.ts";
import { plugin } from "./plugin.ts";
import { createPluginRegistry } from "./registry.ts";
import { http } from "./triggers.ts";

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
});

describe("plugin edge handlers", () => {
  test("an edge handler answers an unmatched request; the flow still owns matched ones", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const edge = plugin("edge-test", { version: "0.0.1" }).edge((_request, info) => {
      if (info.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: { "x-edge": "yes" } });
      }
      return undefined;
    });
    const app = oke({ autoBoot: false, name: "edge" }).plug(edge);

    const preflight = await app.fetch(new Request("http://localhost/x", { method: "OPTIONS" }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("x-edge")).toBe("yes");

    const matched = await app.fetch(new Request("http://localhost/x"));
    expect(matched.status).toBe(200);
    expect(matched.headers.get("x-edge")).toBeNull();
  });

  test("returning undefined falls through to the next handler, then the plain 404", async () => {
    const pass = plugin("edge-pass", { version: "0.0.1" }).edge(() => undefined);
    const answer = plugin("edge-answer", { version: "0.0.1" }).edge(
      () => new Response("answered", { status: 418 }),
    );
    const app = oke({ autoBoot: false, name: "edge-order" }).plug(pass).plug(answer);

    const res = await app.fetch(new Request("http://localhost/nowhere", { method: "OPTIONS" }));
    expect(res.status).toBe(418);
    expect(await res.text()).toBe("answered");

    const noPlugins = oke({ autoBoot: false, name: "edge-none" });
    const missing = await noPlugins.fetch(
      new Request("http://localhost/nowhere", { method: "OPTIONS" }),
    );
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("Not Found");
  });

  test("edge is recorded as an intercept capability", () => {
    const registry = createPluginRegistry();
    const registration = registry.plug(
      plugin("edge-cap", { version: "0.0.1" }).edge(() => undefined),
      { kind: "app" },
    );
    expect(registration?.capabilities.intercepts).toContain("edge");
    expect(registry.edgeHandlers()).toHaveLength(1);
  });
});
