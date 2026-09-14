/**
 * Console SPA static files — filesystem paths, not `file://` URL pathnames.
 *
 * Windows `new URL(...).pathname` is `/C:/…`; concatenating that with
 * `index.html` misses the built SPA and serves the fallback shell.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConsoleStaticDir, serveConsole, type ConsoleServerHandle } from "./serve.ts";

describe("resolveConsoleStaticDir", () => {
  test("is a filesystem path next to this module, not a file URL pathname", () => {
    const dir = resolveConsoleStaticDir();
    const fromMeta = join(import.meta.dir, "../ui-next/dist");
    const fromFileUrl = fileURLToPath(new URL("../ui-next/dist/", import.meta.url));
    expect(dir).toBe(fromMeta);
    expect(dir).toBe(fromFileUrl.replace(/[/\\]+$/, ""));
    expect(dir.startsWith("file:")).toBe(false);
    // URL.pathname on Windows is `/C:/Users/…` — not a Win32 path.
    expect(dir).not.toMatch(/^\/[A-Za-z]:/);
  });

  test("keeps an explicit override", () => {
    expect(resolveConsoleStaticDir("/tmp/console-spa")).toBe("/tmp/console-spa");
  });
});

describe("serveConsole staticDir", () => {
  let server: ConsoleServerHandle | undefined;
  let cwd: string | undefined;
  let staticDir: string | undefined;

  afterAll(async () => {
    await Promise.resolve(server?.stop(true));
    if (cwd) await rm(cwd, { recursive: true, force: true });
    if (staticDir) await rm(staticDir, { recursive: true, force: true });
  });

  test("serves index.html from a directory without a trailing separator", async () => {
    cwd = await mkdtemp(join(tmpdir(), "oke-console-static-cwd-"));
    staticDir = await mkdtemp(join(tmpdir(), "oke-console-static-spa-"));
    await writeFile(join(staticDir, "index.html"), "<!doctype html><title>console-spa</title>");
    await writeFile(join(staticDir, "app.js"), "export {}\n");

    server = await serveConsole({
      port: 0,
      hostname: "127.0.0.1",
      cwd,
      secret: "static-dir-secret",
      silentClaim: true,
      env: "test",
      persist: false,
      staticDir,
    });

    const html = await server.fetch(
      new Request(String(server.url), { headers: { host: "127.0.0.1" } }),
    );
    expect(html.status).toBe(200);
    const body = await html.text();
    expect(body).toContain("console-spa");
    expect(body).not.toContain("Shell assets not built");

    const asset = await server.fetch(
      new Request(String(new URL("/app.js", server.url)), { headers: { host: "127.0.0.1" } }),
    );
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain("export");
  });
});
