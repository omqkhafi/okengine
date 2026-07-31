/**
 * `security-headers` plugin — defaults on success, presence on failure,
 * and app-wins override semantics through the real pipeline.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { oke } from "../kernel/app.ts";
import { flow, resetFlowSeq } from "../kernel/flow.ts";
import { fail } from "../kernel/index.ts";
import { on, resetBindings } from "../kernel/on.ts";
import { http } from "../kernel/triggers.ts";
import { defaultCspDirectives, securityHeaders } from "./security-headers.ts";

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
});

describe("securityHeaders plugin", () => {
  test("sets the default trio on a successful response", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ autoBoot: false, name: "sec" }).plug(securityHeaders());

    const res = await app.fetch(new Request("http://localhost/x"));

    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("content-security-policy")).toBeNull();
  });

  test("helmet-parity defaults: agent cluster, dns prefetch, download, cross-domain, xss filter", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ autoBoot: false, name: "sec-parity" }).plug(securityHeaders());

    const res = await app.fetch(new Request("http://localhost/x"));

    expect(res.headers.get("origin-agent-cluster")).toBe("?1");
    expect(res.headers.get("x-dns-prefetch-control")).toBe("off");
    expect(res.headers.get("x-download-options")).toBe("noopen");
    expect(res.headers.get("x-permitted-cross-domain-policies")).toBe("none");
    expect(res.headers.get("x-xss-protection")).toBe("0");
  });

  test("each parity default can be switched off", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ autoBoot: false, name: "sec-off" }).plug(
      securityHeaders({
        originAgentCluster: false,
        dnsPrefetchControl: false,
        downloadOptions: false,
        xssProtection: false,
      }),
    );

    const res = await app.fetch(new Request("http://localhost/x"));

    expect(res.headers.get("origin-agent-cluster")).toBeNull();
    expect(res.headers.get("x-dns-prefetch-control")).toBeNull();
    expect(res.headers.get("x-download-options")).toBeNull();
    expect(res.headers.get("x-xss-protection")).toBeNull();
    expect(res.headers.get("x-permitted-cross-domain-policies")).toBe("none");
  });

  test("dnsPrefetchControl allow, custom cross-domain policy, COEP stamps when configured", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ autoBoot: false, name: "sec-tuned" }).plug(
      securityHeaders({
        dnsPrefetchControl: { allow: true },
        permittedCrossDomainPolicies: "by-content-type",
        crossOriginEmbedderPolicy: "require-corp",
      }),
    );

    const res = await app.fetch(new Request("http://localhost/x"));

    expect(res.headers.get("x-dns-prefetch-control")).toBe("on");
    expect(res.headers.get("x-permitted-cross-domain-policies")).toBe("by-content-type");
    expect(res.headers.get("cross-origin-embedder-policy")).toBe("require-corp");
  });

  test("x-powered-by is removed by default; a string sets a decoy; false keeps the app's", async () => {
    const poweredByApp = (options: Parameters<typeof securityHeaders>[0], name: string) => {
      on(
        http.get("/x"),
        flow({
          name: "x.get",
          do: () =>
            new Response("{}", {
              headers: { "content-type": "application/json", "x-powered-by": "Express" },
            }),
        }),
      );
      return oke({ autoBoot: false, name }).plug(securityHeaders(options));
    };

    const removed = await poweredByApp({}, "sec-pb-off").fetch(new Request("http://localhost/x"));
    expect(removed.headers.get("x-powered-by")).toBeNull();

    const decoy = await poweredByApp(
      { poweredBy: "PHP 4.2.0", override: true },
      "sec-pb-decoy",
    ).fetch(new Request("http://localhost/x"));
    expect(decoy.headers.get("x-powered-by")).toBe("PHP 4.2.0");

    const kept = await poweredByApp({ poweredBy: false }, "sec-pb-keep").fetch(
      new Request("http://localhost/x"),
    );
    expect(kept.headers.get("x-powered-by")).toBe("Express");
  });

  test("structured CSP merges over helmet's defaults, camelCase keys, report-only mode", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ autoBoot: false, name: "sec-csp-builder" }).plug(
      securityHeaders({
        contentSecurityPolicy: {
          directives: { scriptSrc: ["'self'", "https://cdn.example.com"] },
          reportOnly: true,
        },
      }),
    );

    const res = await app.fetch(new Request("http://localhost/x"));

    expect(res.headers.get("content-security-policy")).toBeNull();
    const reportOnly = res.headers.get("content-security-policy-report-only");
    expect(reportOnly).toContain("script-src 'self' https://cdn.example.com");
    expect(reportOnly).toContain("default-src 'self'");
    expect(reportOnly).toContain("upgrade-insecure-requests");
  });

  test("structured CSP with useDefaults: false emits exactly the given directives", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ autoBoot: false, name: "sec-csp-bare" }).plug(
      securityHeaders({
        contentSecurityPolicy: { useDefaults: false, directives: { "default-src": ["'none'"] } },
      }),
    );

    const res = await app.fetch(new Request("http://localhost/x"));
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
  });

  test("defaultCspDirectives matches helmet's documented default policy", () => {
    expect(defaultCspDirectives["upgrade-insecure-requests"]).toEqual([]);
    expect(defaultCspDirectives["script-src-attr"]).toEqual(["'none'"]);
    expect(Object.keys(defaultCspDirectives)).toHaveLength(11);
  });

  test("headers land on failures too (onResponse runs after onError)", async () => {
    on(
      http.get("/deny"),
      flow({ name: "x.deny", do: () => ({ ok: true }) }).hook("beforeHandle", () =>
        fail("Forbidden", {}),
      ),
    );
    const app = oke({ autoBoot: false, name: "sec-fail" }).plug(securityHeaders());

    const res = await app.fetch(new Request("http://localhost/deny"));

    expect(res.status).not.toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("adds CSP only when configured", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ autoBoot: false, name: "sec-csp" }).plug(
      securityHeaders({ contentSecurityPolicy: "default-src 'self'" }),
    );

    const res = await app.fetch(new Request("http://localhost/x"));

    expect(res.headers.get("content-security-policy")).toBe("default-src 'self'");
  });

  test("HSTS is off by default", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ autoBoot: false, name: "sec-hsts-off" }).plug(securityHeaders());

    const res = await app.fetch(new Request("http://localhost/x"));

    expect(res.headers.get("strict-transport-security")).toBeNull();
  });

  test("hsts: true stamps a one-year max-age", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ autoBoot: false, name: "sec-hsts-on" }).plug(securityHeaders({ hsts: true }));

    const res = await app.fetch(new Request("http://localhost/x"));

    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000");
  });

  test("hsts object tunes max-age, subdomains, preload", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ autoBoot: false, name: "sec-hsts-tuned" }).plug(
      securityHeaders({ hsts: { maxAge: 63072000, includeSubDomains: true, preload: true } }),
    );

    const res = await app.fetch(new Request("http://localhost/x"));

    expect(res.headers.get("strict-transport-security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
  });

  test("permissions-policy and cross-origin policies stamp when configured", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ autoBoot: false, name: "sec-extra" }).plug(
      securityHeaders({
        permissionsPolicy: "camera=(), microphone=()",
        crossOriginOpenerPolicy: "same-origin",
        crossOriginResourcePolicy: "same-site",
      }),
    );

    const res = await app.fetch(new Request("http://localhost/x"));

    expect(res.headers.get("permissions-policy")).toBe("camera=(), microphone=()");
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-site");
  });

  test("an explicit app-set value wins by default", async () => {
    on(http.get("/x"), flow({ name: "x.get", do: () => ({ ok: true }) }));
    const app = oke({ autoBoot: false, name: "sec-keep" });
    app.hook("onResponse", (ctx) => {
      if (!ctx.response) return;
      const headers = new Headers(ctx.response.headers);
      headers.set("x-frame-options", "SAMEORIGIN");
      ctx.response = new Response(ctx.response.body, {
        status: ctx.response.status,
        headers,
      });
    });
    app.plug(securityHeaders());

    const res = await app.fetch(new Request("http://localhost/x"));

    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });
});
