/**
 * `ip-allowlist` plugin — allow/deny semantics, XFF parsing, and
 * missing-header behavior through the real pipeline.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { oke } from "../kernel/app.ts";
import { flow, resetFlowSeq } from "../kernel/flow.ts";
import { on, resetBindings } from "../kernel/on.ts";
import { http } from "../kernel/triggers.ts";
import { ipAllowlist } from "./ip-allowlist.ts";

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
});

/** Shorthand: GET /x with an optional x-forwarded-for header. */
function get(ip?: string): Request {
  return new Request(
    "http://localhost/x",
    ip === undefined ? undefined : { headers: { "x-forwarded-for": ip } },
  );
}

describe("ipAllowlist plugin", () => {
  test("allow list: listed IPs pass, others get 403 Forbidden", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ name: "ips" }).plug(ipAllowlist({ allow: ["203.0.113.7"] }));

    const ok = await app.fetch(get("203.0.113.7"));
    expect(ok.status).toBe(200);

    const denied = await app.fetch(get("198.51.100.9"));
    expect(denied.status).toBe(403);
    const body = (await denied.json()) as { error: { code: string; data: { reason: string } } };
    expect(body.error.code).toBe("Forbidden");
    expect(body.error.data.reason).toBe("ip_not_allowed");
  });

  test("deny list: blocked IPs get 403 ip_denied, others pass", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ name: "ips-deny" }).plug(ipAllowlist({ deny: ["198.51.100.9"] }));

    const blocked = await app.fetch(get("198.51.100.9"));
    expect(blocked.status).toBe(403);
    const body = (await blocked.json()) as { error: { data: { reason: string } } };
    expect(body.error.data.reason).toBe("ip_denied");

    const ok = await app.fetch(get("203.0.113.7"));
    expect(ok.status).toBe(200);
  });

  test("deny wins over allow on overlap", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ name: "ips-both" }).plug(
      ipAllowlist({ allow: ["203.0.113.7"], deny: ["203.0.113.7"] }),
    );

    const res = await app.fetch(get("203.0.113.7"));
    expect(res.status).toBe(403);
  });

  test("XFF last hop is the client; a spoofed first hop cannot bypass allow", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ name: "ips-xff" }).plug(ipAllowlist({ allow: ["203.0.113.7"] }));

    // Attacker-controlled first hop + trusted proxy appended the real client (last).
    const spoofedFirst = await app.fetch(get("203.0.113.7, 198.51.100.9"));
    expect(spoofedFirst.status).toBe(403);

    const realLast = await app.fetch(get("198.51.100.9, 203.0.113.7"));
    expect(realLast.status).toBe(200);
  });

  test("spoofed first hop cannot bypass a deny rule", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ name: "ips-xff-deny" }).plug(ipAllowlist({ deny: ["198.51.100.9"] }));

    // Spoof a non-denied IP first; proxy appended the real (denied) client last.
    const spoofed = await app.fetch(get("203.0.113.7, 198.51.100.9"));
    expect(spoofed.status).toBe(403);
    const body = (await spoofed.json()) as { error: { data: { reason: string; ip: string } } };
    expect(body.error.data.reason).toBe("ip_denied");
    expect(body.error.data.ip).toBe("198.51.100.9");
  });

  test("trustedProxyDepth selects the hop behind N trusted proxies", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    // Chain: spoofed, real-client, cdn-egress — depth 2 skips the nearest proxy hop.
    const app = oke({ name: "ips-depth" }).plug(
      ipAllowlist({ allow: ["203.0.113.7"], trustedProxyDepth: 2 }),
    );

    const ok = await app.fetch(get("198.51.100.1, 203.0.113.7, 10.0.0.2"));
    expect(ok.status).toBe(200);

    // Second-from-last is not allow-listed → denied (depth must match topology).
    const denied = await app.fetch(get("198.51.100.1, 198.51.100.9, 10.0.0.2"));
    expect(denied.status).toBe(403);
  });

  test("trustedProxyDepth < 1 throws at construction", () => {
    expect(() => ipAllowlist({ allow: ["203.0.113.7"], trustedProxyDepth: 0 })).toThrow(
      /trustedProxyDepth/i,
    );
  });

  test("missing header: denied when allow is set, permitted for deny-only", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const strict = oke({ name: "ips-missing-allow" }).plug(ipAllowlist({ allow: ["203.0.113.7"] }));

    const denied = await strict.fetch(get());
    expect(denied.status).toBe(403);

    resetBindings();
    resetFlowSeq();
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));

    const lax = oke({ name: "ips-missing-deny" }).plug(ipAllowlist({ deny: ["198.51.100.9"] }));
    const ok = await lax.fetch(get());
    expect(ok.status).toBe(200);
  });

  test("custom header name is honored", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ name: "ips-custom" }).plug(
      ipAllowlist({ allow: ["203.0.113.7"], header: "x-real-ip" }),
    );

    const res = await app.fetch(
      new Request("http://localhost/x", { headers: { "x-real-ip": "203.0.113.7" } }),
    );
    expect(res.status).toBe(200);

    const wrongHeader = await app.fetch(get("203.0.113.7"));
    expect(wrongHeader.status).toBe(403);
  });
});
