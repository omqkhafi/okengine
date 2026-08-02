/**
 * Evidence: createClient has no live-signal subscription today.
 *
 * `delivery: "live"` is consumed server-side via `bus.live()` (and
 * `on(signal, flow)` for flow subscribers). `okengine/client` exposes only
 * HTTP REST / RPC — no SSE, WebSocket, or `api.live(…)`.
 *
 * Design for `client.live(signalName)` is tracked with the Signal docs page;
 * do not treat this file as a stub to fill — ship the real surface when ready.
 */

import { describe, expect, test } from "bun:test";

import * as client from "./index.ts";
import { createClient } from "./create.ts";

describe("createClient — live signal gap", () => {
  test("public client module exports no live / subscribe helpers", () => {
    const keys = Object.keys(client).sort();
    expect(keys).not.toContain("live");
    expect(keys).not.toContain("subscribe");
    expect(keys).toContain("createClient");
    expect(keys).toContain("createTransport");
  });

  test("createClient builds an HTTP call proxy only (no live method on the root)", async () => {
    const api = createClient("http://app.test", {
      fetch: async () => Response.json({ data: null, error: { code: "NotFound", data: {} } }),
    });
    // Root is a callable proxy for unit.flow — live is not a first-class API.
    expect(typeof api).toBe("function");
    expect(Object.prototype.hasOwnProperty.call(api, "live")).toBe(false);
    expect("live" in (api as object)).toBe(false);
  });
});
