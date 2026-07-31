/**
 * `compression` plugin — gzip negotiation, thresholds, and skip rules
 * through the real pipeline.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { oke } from "../kernel/app.ts";
import { flow, resetFlowSeq } from "../kernel/flow.ts";
import { on, resetBindings } from "../kernel/on.ts";
import { http } from "../kernel/triggers.ts";
import { acceptsGzip, compression } from "./compression.ts";

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
});

/** Big JSON payload above the default 1 KiB threshold. */
function bigPayload() {
  return { items: Array.from({ length: 100 }, (_, i) => ({ id: i, name: `item-${i}` })) };
}

describe("acceptsGzip", () => {
  test("parses plain, starred, and q-valued tokens", () => {
    expect(acceptsGzip(null)).toBe(false);
    expect(acceptsGzip("")).toBe(false);
    expect(acceptsGzip("gzip")).toBe(true);
    expect(acceptsGzip("br, gzip")).toBe(true);
    expect(acceptsGzip("gzip;q=0")).toBe(false);
    expect(acceptsGzip("gzip;q=0.0")).toBe(false);
    expect(acceptsGzip("gzip;q=0.5")).toBe(true);
    expect(acceptsGzip("*")).toBe(true);
    expect(acceptsGzip("*;q=0")).toBe(false);
    expect(acceptsGzip("br")).toBe(false);
  });
});

describe("compression plugin", () => {
  test("gzips a large JSON body when the client accepts gzip", async () => {
    on(http.get("/big"), flow({ name: "big.get", do: bigPayload }));
    const app = oke({ autoBoot: false, name: "zip" }).plug(compression());

    const res = await app.fetch(
      new Request("http://localhost/big", { headers: { "accept-encoding": "gzip" } }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("vary")).toContain("accept-encoding");
    expect(res.headers.get("content-length")).toBeNull();

    const roundTrip = JSON.parse(
      new TextDecoder().decode(Bun.gunzipSync(await res.arrayBuffer())),
    ) as {
      data: { items: unknown[] };
    };
    expect(roundTrip.data.items).toHaveLength(100);
  });

  test("passes through untouched without Accept-Encoding: gzip", async () => {
    on(http.get("/big"), flow({ name: "big.get", do: bigPayload }));
    const app = oke({ autoBoot: false, name: "zip-plain" }).plug(compression());

    const res = await app.fetch(new Request("http://localhost/big"));

    expect(res.headers.get("content-encoding")).toBeNull();
    const body = (await res.json()) as { data: { items: unknown[] } };
    expect(body.data.items).toHaveLength(100);
  });

  test("skips bodies under minSize", async () => {
    on(http.get("/small"), flow({ name: "small.get", do: () => ({ ok: true }) }));
    const app = oke({ autoBoot: false, name: "zip-small" }).plug(compression());

    const res = await app.fetch(
      new Request("http://localhost/small", { headers: { "accept-encoding": "gzip" } }),
    );

    expect(res.headers.get("content-encoding")).toBeNull();
  });

  test("minSize: 0 compresses even tiny bodies", async () => {
    on(http.get("/small"), flow({ name: "small.get", do: () => ({ ok: true }) }));
    const app = oke({ autoBoot: false, name: "zip-zero" }).plug(compression({ minSize: 0 }));

    const res = await app.fetch(
      new Request("http://localhost/small", { headers: { "accept-encoding": "gzip" } }),
    );

    expect(res.headers.get("content-encoding")).toBe("gzip");
  });

  test("skips non-matching content types and no-transform responses", async () => {
    on(
      http.get("/img"),
      flow({
        name: "img.get",
        do: () =>
          new Response(new Uint8Array(4096), {
            headers: { "content-type": "image/png" },
          }),
      }),
    );
    on(
      http.get("/nt"),
      flow({
        name: "nt.get",
        do: () =>
          Response.json(
            { data: bigPayload(), error: null },
            { headers: { "cache-control": "no-transform" } },
          ),
      }),
    );
    const app = oke({ autoBoot: false, name: "zip-skip" }).plug(compression());

    const img = await app.fetch(
      new Request("http://localhost/img", { headers: { "accept-encoding": "gzip" } }),
    );
    expect(img.headers.get("content-encoding")).toBeNull();

    const nt = await app.fetch(
      new Request("http://localhost/nt", { headers: { "accept-encoding": "gzip" } }),
    );
    expect(nt.headers.get("content-encoding")).toBeNull();
  });
});
