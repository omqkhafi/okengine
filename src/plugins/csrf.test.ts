/**
 * `csrf` plugin — fetch-metadata defense with an Origin fallback, through
 * the real pipeline.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { oke } from "../kernel/app.ts";
import { flow, resetFlowSeq } from "../kernel/flow.ts";
import { on, resetBindings } from "../kernel/on.ts";
import { http } from "../kernel/triggers.ts";
import { csrf } from "./csrf.ts";

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
});

function mutating(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/transfer", { method: "POST", headers });
}

function appWith(options: Parameters<typeof csrf>[0]) {
  on(http.post("/transfer"), flow({ name: "transfer.create", do: () => ({ moved: true }) }));
  on(http.get("/balance"), flow({ name: "balance.get", do: () => ({ balance: 5 }) }));
  return oke({ autoBoot: false, name: `csrf-${crypto.randomUUID()}` }).plug(csrf(options));
}

describe("csrf plugin", () => {
  test("safe methods always pass", async () => {
    const app = appWith({});
    const res = await app.fetch(
      new Request("http://localhost/balance", {
        headers: { "sec-fetch-site": "cross-site", origin: "https://evil.com" },
      }),
    );
    expect(res.status).toBe(200);
  });

  test("same-origin and none pass; cross-site is denied with typed Forbidden", async () => {
    const app = appWith({});

    const same = await app.fetch(mutating({ "sec-fetch-site": "same-origin" }));
    expect(same.status).toBe(200);

    const cross = await app.fetch(
      mutating({ "sec-fetch-site": "cross-site", origin: "https://evil.com" }),
    );
    expect(cross.status).toBe(403);
    const body = (await cross.json()) as { error: { code: string; data: { reason: string } } };
    expect(body.error.code).toBe("Forbidden");
    expect(body.error.data.reason).toBe("csrf");
  });

  test("same-site passes by default, blocked when allowSameSite: false", async () => {
    const lax = appWith({});
    expect(
      (
        await lax.fetch(
          mutating({ "sec-fetch-site": "same-site", origin: "https://sub.localhost" }),
        )
      ).status,
    ).toBe(200);

    const strict = appWith({ allowSameSite: false });
    const res = await strict.fetch(
      mutating({ "sec-fetch-site": "same-site", origin: "https://sub.localhost" }),
    );
    expect(res.status).toBe(403);
  });

  test("Origin fallback: same-origin host passes, allow-listed origins pass, others fail", async () => {
    const app = appWith({ allowOrigins: ["https://admin.example.com"] });

    const sameHost = await app.fetch(mutating({ origin: "http://localhost" }));
    expect(sameHost.status).toBe(200);

    const listed = await app.fetch(mutating({ origin: "https://admin.example.com" }));
    expect(listed.status).toBe(200);

    const evil = await app.fetch(mutating({ origin: "https://evil.com" }));
    expect(evil.status).toBe(403);
  });

  test("headerless mutating requests pass by default (curl, webhooks), fail closed on demand", async () => {
    const lax = appWith({});
    expect((await lax.fetch(mutating())).status).toBe(200);

    const closed = appWith({ allowNoHeader: false });
    const res = await closed.fetch(mutating());
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("Forbidden");
  });

  test("cross-site with an allow-listed origin passes (metadata wins are not required)", async () => {
    const app = appWith({ allowOrigins: ["https://admin.example.com"] });
    const res = await app.fetch(
      mutating({ "sec-fetch-site": "cross-site", origin: "https://admin.example.com" }),
    );
    expect(res.status).toBe(200);
  });
});
