/**
 * `cors` plugin — preflight at the edge, CORS headers on matched
 * responses, closed-by-default origin rule.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { oke } from "../kernel/app.ts";
import { flow, resetFlowSeq } from "../kernel/flow.ts";
import { on, resetBindings } from "../kernel/on.ts";
import { http } from "../kernel/triggers.ts";
import { cors, originAllowed } from "./cors.ts";

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
});

function preflight(path = "/x", headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, {
    method: "OPTIONS",
    headers: {
      origin: "https://app.example.com",
      "access-control-request-method": "POST",
      ...headers,
    },
  });
}

describe("cors plugin — preflight", () => {
  test("answers preflight for a path bound to another method (edge)", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ name: "cors-pre" }).plug(cors({ origin: "https://app.example.com" }));

    const res = await app.fetch(preflight());

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("vary")).toContain("origin");
  });

  test("denied origins get a 204 without CORS headers — the browser blocks quietly", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ name: "cors-deny" }).plug(cors({ origin: "https://other.example.com" }));

    const res = await app.fetch(preflight());

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("no origin configured answers nothing — cross-origin closed by default", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ name: "cors-closed" }).plug(cors());

    const res = await app.fetch(preflight());
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("a plain unmatched OPTIONS without preflight headers still 404s", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ name: "cors-404" }).plug(cors({ origin: "*" }));

    const res = await app.fetch(new Request("http://localhost/x", { method: "OPTIONS" }));
    expect(res.status).toBe(404);
  });

  test("reflects request headers by default, honors configured lists and maxAge", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ name: "cors-hdr" }).plug(
      cors({ origin: "*", maxAge: 600, allowedHeaders: ["x-custom"] }),
    );

    const reflected = await app.fetch(
      preflight("/x", { "access-control-request-headers": "authorization, content-type" }),
    );
    // Configured list wins over reflection.
    expect(reflected.headers.get("access-control-allow-headers")).toBe("x-custom");
    expect(reflected.headers.get("access-control-max-age")).toBe("600");
    expect(reflected.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("credentials reflect the origin instead of stamping *", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ name: "cors-cred" }).plug(cors({ origin: "*", credentials: true }));

    const res = await app.fetch(preflight());
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });
});

describe("cors plugin — actual requests", () => {
  test("allowed origins get allow-origin (+ exposed headers) on matched responses", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ name: "cors-actual" }).plug(
      cors({ origin: ["https://app.example.com"], exposedHeaders: ["x-total"] }),
    );

    const res = await app.fetch(
      new Request("http://localhost/x", { headers: { origin: "https://app.example.com" } }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    expect(res.headers.get("access-control-expose-headers")).toBe("x-total");
  });

  test("denied origins get no CORS headers on matched responses", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ name: "cors-actual-deny" }).plug(cors({ origin: "https://ok.example.com" }));

    const res = await app.fetch(
      new Request("http://localhost/x", { headers: { origin: "https://evil.example.com" } }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("requests without an Origin header are untouched", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ name: "cors-no-origin" }).plug(cors({ origin: "*" }));

    const res = await app.fetch(new Request("http://localhost/x"));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("originAllowed", () => {
  test("undefined / * / string / list", () => {
    expect(originAllowed("https://a.com", undefined)).toBe(false);
    expect(originAllowed("https://a.com", "*")).toBe(true);
    expect(originAllowed("https://a.com", "https://a.com")).toBe(true);
    expect(originAllowed("https://b.com", "https://a.com")).toBe(false);
    expect(originAllowed("https://b.com", ["https://a.com", "https://b.com"])).toBe(true);
  });
});
