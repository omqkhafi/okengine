/**
 * QUERY method passthrough through real Caddy and Traefik binaries.
 *
 * Uses HTTP-only configs that reuse the recipe reverse_proxy / loadbalancer
 * primitives (production recipes terminate TLS). Opt-in via `OKE_TEST_DOCKER=1`.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function dockerAvailable(): boolean {
  try {
    return Bun.spawnSync(["docker", "info"], { stdout: "pipe", stderr: "pipe" }).exitCode === 0;
  } catch {
    return false;
  }
}

const WANT = process.env.OKE_TEST_DOCKER === "1";
const DOCKER = WANT && dockerAvailable();
if (!DOCKER) {
  console.log(
    WANT
      ? "skip: QUERY proxy passthrough (docker daemon not available)"
      : "skip: QUERY proxy passthrough (OKE_TEST_DOCKER≠1)",
  );
}
const live = DOCKER ? test : test.skip;

const QUERY_BODY = { n: 7 } as const;

async function waitFor(
  url: string,
  init: RequestInit,
  attempts = 40,
): Promise<Response | undefined> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init);
      if (res.status !== 502 && res.status !== 503) return res;
    } catch {
      // proxy not ready
    }
    await Bun.sleep(250);
  }
  return undefined;
}

async function dockerPort(name: string, containerPort: string): Promise<string> {
  const proc = Bun.spawn(["docker", "port", name, containerPort], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  const m = out.match(/:(\d+)/);
  if (!m?.[1]) {
    throw new Error(`docker port ${name} ${containerPort}: ${out}`);
  }
  return m[1];
}

async function dockerRm(name: string): Promise<void> {
  await Bun.spawn(["docker", "rm", "-f", name], {
    stdout: "pipe",
    stderr: "pipe",
  }).exited;
}

describe("QUERY passthrough — Caddy + Traefik", () => {
  const names: string[] = [];
  let echo: ReturnType<typeof Bun.serve> | undefined;

  afterAll(async () => {
    echo?.stop();
    await Promise.all(names.map((n) => dockerRm(n)));
  });

  live(
    "Caddy reverse_proxy and Traefik loadbalancer forward QUERY with a JSON body",
    async () => {
      echo = Bun.serve({
        hostname: "0.0.0.0",
        port: 0,
        async fetch(request) {
          let body: unknown;
          try {
            body = await request.json();
          } catch {
            body = null;
          }
          return Response.json({ method: request.method, body });
        },
      });
      const upstream = echo.port;
      const dir = await mkdtemp(join(tmpdir(), "oke-query-proxy-"));
      const stamp = Date.now();

      try {
        const caddyfile = [
          "http://:80 {",
          `	reverse_proxy host.docker.internal:${upstream}`,
          "}",
          "",
        ].join("\n");
        const caddyPath = join(dir, "Caddyfile");
        await Bun.write(caddyPath, caddyfile);

        const traefikYml = [
          "http:",
          "  routers:",
          "    app:",
          "      rule: PathPrefix(`/`)",
          "      entryPoints:",
          "        - web",
          "      service: app",
          "  services:",
          "    app:",
          "      loadBalancer:",
          "        servers:",
          `          - url: http://host.docker.internal:${upstream}`,
          "",
        ].join("\n");
        const traefikPath = join(dir, "traefik.yml");
        await Bun.write(traefikPath, traefikYml);

        const caddyName = `oke-query-caddy-${stamp}`;
        const traefikName = `oke-query-traefik-${stamp}`;
        names.push(caddyName, traefikName);

        const caddyRun = Bun.spawn(
          [
            "docker",
            "run",
            "-d",
            "--name",
            caddyName,
            "-p",
            "0:80",
            "--add-host",
            "host.docker.internal:host-gateway",
            "-v",
            `${caddyPath}:/etc/caddy/Caddyfile:ro`,
            "caddy:2-alpine",
          ],
          { stdout: "pipe", stderr: "pipe" },
        );
        const [, caddyErr, caddyCode] = await Promise.all([
          new Response(caddyRun.stdout).text(),
          new Response(caddyRun.stderr).text(),
          caddyRun.exited,
        ]);
        expect(caddyCode).toBe(0);
        if (caddyCode !== 0) console.error(caddyErr);

        const traefikRun = Bun.spawn(
          [
            "docker",
            "run",
            "-d",
            "--name",
            traefikName,
            "-p",
            "0:80",
            "--add-host",
            "host.docker.internal:host-gateway",
            "-v",
            `${traefikPath}:/etc/traefik/dynamic.yml:ro`,
            "traefik:v3.3",
            "--entrypoints.web.address=:80",
            "--providers.file.filename=/etc/traefik/dynamic.yml",
            "--ping=true",
          ],
          { stdout: "pipe", stderr: "pipe" },
        );
        const [, traefikErr, traefikCode] = await Promise.all([
          new Response(traefikRun.stdout).text(),
          new Response(traefikRun.stderr).text(),
          traefikRun.exited,
        ]);
        expect(traefikCode).toBe(0);
        if (traefikCode !== 0) console.error(traefikErr);

        const caddyPort = await dockerPort(caddyName, "80");
        const traefikPort = await dockerPort(traefikName, "80");
        const init: RequestInit = {
          method: "QUERY",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(QUERY_BODY),
        };

        const caddyRes = await waitFor(`http://127.0.0.1:${caddyPort}/q`, init);
        expect(caddyRes).toBeDefined();
        expect(caddyRes!.status).toBe(200);
        expect(await caddyRes!.json()).toEqual({ method: "QUERY", body: QUERY_BODY });

        const traefikRes = await waitFor(`http://127.0.0.1:${traefikPort}/q`, init);
        expect(traefikRes).toBeDefined();
        expect(traefikRes!.status).toBe(200);
        expect(await traefikRes!.json()).toEqual({ method: "QUERY", body: QUERY_BODY });
      } finally {
        echo.stop();
        echo = undefined;
        await Promise.all(names.splice(0).map((n) => dockerRm(n)));
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
    180_000,
  );
});
