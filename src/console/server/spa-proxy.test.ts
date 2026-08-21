/**
 * Console SPA proxy — Vite HMR origin for non-kernel paths.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONSOLE_CSP, CONSOLE_VITE_DEV_CSP } from "./security-headers.ts";
import { proxySpa, serveConsole, type ConsoleServerHandle } from "./serve.ts";

describe("proxySpa", () => {
  test("returns null when the origin is unreachable", async () => {
    const res = await proxySpa("http://127.0.0.1:1", new Request("http://127.0.0.1:6533/"));
    expect(res).toBeNull();
  });
});

describe("serveConsole spaProxy", () => {
  let server: ConsoleServerHandle;
  let vite: ReturnType<typeof Bun.serve>;

  beforeAll(async () => {
    const cwd = await mkdtemp(join(tmpdir(), "oke-console-spa-proxy-"));
    vite = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/@vite/client") {
          return new Response("/* vite client */", {
            headers: { "Content-Type": "text/javascript" },
          });
        }
        return new Response("<!doctype html><title>vite-spa</title>", {
          headers: { "Content-Type": "text/html" },
        });
      },
    });
    server = await serveConsole({
      port: 0,
      hostname: "127.0.0.1",
      cwd,
      secret: "spa-proxy-secret",
      silentClaim: true,
      env: "test",
      persist: false,
      spaProxy: { origin: `http://127.0.0.1:${vite.port}` },
    });
  });

  afterAll(() => {
    server?.stop(true);
    vite?.stop(true);
  });

  test("proxies the SPA shell and Vite client through Console", async () => {
    const html = await server.fetch(
      new Request(String(server.url), { headers: { host: "127.0.0.1" } }),
    );
    expect(html.status).toBe(200);
    expect(html.headers.get("content-security-policy")).toBe(CONSOLE_VITE_DEV_CSP);
    expect(html.headers.get("content-security-policy")).toContain("unsafe-inline");
    expect(html.headers.get("content-security-policy")).toContain("frame-src 'self' blob:");
    expect(await html.text()).toContain("vite-spa");

    const client = await server.fetch(
      new Request(String(new URL("/@vite/client", server.url)), {
        headers: { host: "127.0.0.1" },
      }),
    );
    expect(client.status).toBe(200);
    expect(await client.text()).toContain("vite client");
  });

  test("keeps /console API on the kernel", async () => {
    const res = await server.fetch(
      new Request(String(new URL("/console/setup/status", server.url)), {
        headers: { host: "127.0.0.1" },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(CONSOLE_CSP);
    const body = (await res.json()) as { data?: { claimRequired?: boolean } };
    expect(body.data?.claimRequired).toBe(true);
  });
});
