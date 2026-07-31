/**
 * `maintenance-mode` plugin — 503 drain behavior, allow-paths, bypass
 * header, and non-HTTP no-op through the real pipeline.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { oke } from "../kernel/app.ts";
import { flow, resetFlowSeq } from "../kernel/flow.ts";
import { on, resetBindings } from "../kernel/on.ts";
import { http } from "../kernel/triggers.ts";
import { maintenanceMode } from "./maintenance-mode.ts";

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
});

describe("maintenanceMode plugin", () => {
  test("returns 503 with ServiceUnavailable envelope and Retry-After", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ autoBoot: false, name: "maint" }).plug(maintenanceMode({ retryAfter: 120 }));

    const res = await app.fetch(new Request("http://localhost/x"));

    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("120");
    const body = (await res.json()) as {
      data: null;
      error: { code: string; data: { retryAfter?: number }; message?: string };
    };
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("ServiceUnavailable");
    expect(body.error.data.retryAfter).toBe(120);
    expect(body.error.message).toBe("Service is under maintenance.");
  });

  test("enabled: false passes traffic through", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ autoBoot: false, name: "maint-off" }).plug(
      maintenanceMode({ enabled: false }),
    );

    const res = await app.fetch(new Request("http://localhost/x"));

    expect(res.status).toBe(200);
  });

  test("allowPaths prefixes keep serving", async () => {
    on(http.get("/health"), flow({ name: "health.get", do: () => ({ up: true }) }));
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ autoBoot: false, name: "maint-allow" }).plug(
      maintenanceMode({ allowPaths: ["/health"] }),
    );

    const health = await app.fetch(new Request("http://localhost/health"));
    expect(health.status).toBe(200);

    const x = await app.fetch(new Request("http://localhost/x"));
    expect(x.status).toBe(503);
  });

  test("bypass header lets operators through (any non-empty value)", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ autoBoot: false, name: "maint-bypass" }).plug(
      maintenanceMode({ bypassHeader: "x-ops-token" }),
    );

    const blocked = await app.fetch(new Request("http://localhost/x"));
    expect(blocked.status).toBe(503);

    const allowed = await app.fetch(
      new Request("http://localhost/x", { headers: { "x-ops-token": "let-me-in" } }),
    );
    expect(allowed.status).toBe(200);
  });

  test("the 503 still flows through onResponse (other plugins stamp it)", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ autoBoot: false, name: "maint-stamp" }).plug(maintenanceMode());
    app.hook("onResponse", (ctx) => {
      if (!ctx.response) return;
      const headers = new Headers(ctx.response.headers);
      headers.set("x-stamped", "yes");
      ctx.response = new Response(ctx.response.body, {
        status: ctx.response.status,
        headers,
      });
    });

    const res = await app.fetch(new Request("http://localhost/x"));

    expect(res.status).toBe(503);
    expect(res.headers.get("x-stamped")).toBe("yes");
  });
});
