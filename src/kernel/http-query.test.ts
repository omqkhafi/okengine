/**
 * HTTP QUERY trigger (RFC 10008) and 405 + Allow for wrong-method hits.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { cors } from "../plugins/cors.ts";
import { oke } from "./app.ts";
import { flow, resetFlowSeq } from "./flow.ts";
import { on, resetBindings } from "./on.ts";
import { http } from "./triggers.ts";

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
});

describe("http.query — RFC 10008", () => {
  test("a QUERY flow receives the JSON body exactly as POST does", async () => {
    const schema = z.object({ n: z.number() });
    on(
      http.query("/q"),
      flow("q.run", {
        in: schema,
        do: (input: { n: number }) => input,
      }),
    );
    on(
      http.post("/p"),
      flow("p.run", {
        in: schema,
        do: (input: { n: number }) => input,
      }),
    );
    const app = oke({ autoBoot: false, name: "query-body" });

    const queryRes = await app.fetch(
      new Request("http://localhost/q", {
        method: "QUERY",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ n: 7 }),
      }),
    );
    expect(queryRes.status).toBe(200);
    expect(await queryRes.json()).toEqual({ data: { n: 7 }, error: null });

    const postRes = await app.fetch(
      new Request("http://localhost/p", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ n: 7 }),
      }),
    );
    expect(postRes.status).toBe(200);
    expect(await postRes.json()).toEqual({ data: { n: 7 }, error: null });
  });
});

describe("405 Method Not Allowed + Allow", () => {
  for (const preset of ["default", "edge"] as const) {
    test(`${preset}: POST-only route hit with GET → 405 Allow: POST`, async () => {
      on(http.post("/only-post"), flow("only.post", { do: () => ({ ok: true }) }));
      const app = oke({ autoBoot: false, name: `405-post-${preset}`, router: preset });
      const res = await app.fetch(new Request("http://localhost/only-post", { method: "GET" }));
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
      expect(await res.text()).toBe("Method Not Allowed");
    });

    test(`${preset}: QUERY-only route hit with POST → 405 Allow: QUERY`, async () => {
      on(http.query("/only-query"), flow("only.query", { do: () => ({ ok: true }) }));
      const app = oke({ autoBoot: false, name: `405-query-${preset}`, router: preset });
      const res = await app.fetch(
        new Request("http://localhost/only-query", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      );
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("QUERY");
    });

    test(`${preset}: unregistered path still 404s`, async () => {
      on(http.get("/exists"), flow("exists.get", { do: () => ({ ok: true }) }));
      const app = oke({ autoBoot: false, name: `404-${preset}`, router: preset });
      const res = await app.fetch(new Request("http://localhost/nowhere"));
      expect(res.status).toBe(404);
      expect(res.headers.get("allow")).toBeNull();
      expect(await res.text()).toBe("Not Found");
    });
  }

  test("CORS preflight still 204 before 405", async () => {
    on(http.post("/x"), flow("x.post", { do: () => ({ ok: true }) }));
    const app = oke({ autoBoot: false, name: "405-cors" }).plug(
      cors({ origin: "https://app.example.com" }),
    );
    const preflight = await app.fetch(
      new Request("http://localhost/x", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example.com",
          "access-control-request-method": "POST",
        },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
  });
});
