/**
 * Integration: generated Dockerfile builds (and optionally runs).
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveInfrastructure, writeDerivedFiles } from "./index.ts";

async function dockerAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["docker", "info"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

describe("generated Dockerfile integration", () => {
  test("oke docker output builds and runs", async () => {
    if (!(await dockerAvailable())) {
      console.warn("skipping: docker daemon not available");
      return;
    }

    const dir = await mkdtemp(join(tmpdir(), "oke-df-build-"));
    try {
      // Minimal app that `oke start` can import.
      await Bun.write(
        join(dir, "package.json"),
        JSON.stringify(
          {
            name: "oke-docker-fixture",
            private: true,
            type: "module",
            bin: { oke: "./oke.ts" },
            scripts: { start: "bun ./app.ts" },
            okengine: { entry: "./app.ts" },
          },
          null,
          2,
        ),
      );
      await Bun.write(
        join(dir, "oke.ts"),
        `#!/usr/bin/env bun
const [cmd] = process.argv.slice(2);
if (cmd === "start") {
  await import("./app.ts");
} else {
  console.error("fixture oke: unknown", cmd);
  process.exit(1);
}
`,
      );
      await Bun.write(
        join(dir, "app.ts"),
        `const server = Bun.serve({
  port: Number(process.env.PORT ?? 6530),
  hostname: "0.0.0.0",
  fetch() {
    return Response.json({ ok: true });
  },
});
console.log("listening", server.port);
`,
      );

      // No lockfile — adjust Dockerfile install for the fixture.
      const derived = deriveInfrastructure({
        images: { "store.sql": "postgres:18-alpine" },
        credentials: {
          "store.sql": {
            user: "oke",
            password: "fixture-pass",
            database: "oke",
          },
        },
        app: "fixture",
      });
      await writeDerivedFiles(derived, dir);

      // Fixture has no bun.lock — rewrite install step.
      let df = await Bun.file(join(dir, "Dockerfile")).text();
      df = df.replace(
        "RUN bun install --frozen-lockfile --production",
        "RUN bun install --production",
      );
      await Bun.write(join(dir, "Dockerfile"), df);

      const tag = `oke-docker-fixture:${Date.now()}`;
      const build = Bun.spawn(
        ["docker", "build", "-t", tag, dir],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [buildOut, buildErr, buildCode] = await Promise.all([
        new Response(build.stdout).text(),
        new Response(build.stderr).text(),
        build.exited,
      ]);
      expect(buildCode).toBe(0);
      if (buildCode !== 0) {
        console.error(buildOut, buildErr);
      }

      const name = `oke-fixture-run-${Date.now()}`;
      const run = Bun.spawn(
        [
          "docker",
          "run",
          "-d",
          "--name",
          name,
          "-p",
          "0:6530",
          tag,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [runOut, runErr, runCode] = await Promise.all([
        new Response(run.stdout).text(),
        new Response(run.stderr).text(),
        run.exited,
      ]);
      expect(runCode).toBe(0);
      if (runCode !== 0) console.error(runOut, runErr);

      // Resolve published port
      const portProc = Bun.spawn(
        ["docker", "port", name, "6530"],
        { stdout: "pipe", stderr: "pipe" },
      );
      const portOut = await new Response(portProc.stdout).text();
      await portProc.exited;
      const m = portOut.match(/:(\d+)/);
      expect(m).toBeTruthy();
      const hostPort = m![1]!;

      let body: { ok?: boolean } | null = null;
      for (let i = 0; i < 20; i++) {
        try {
          const res = await fetch(`http://127.0.0.1:${hostPort}/`);
          if (res.ok) {
            body = (await res.json()) as { ok?: boolean };
            break;
          }
        } catch {
          await Bun.sleep(250);
        }
      }
      expect(body?.ok).toBe(true);

      await Bun.spawn(["docker", "rm", "-f", name], {
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
      await Bun.spawn(["docker", "rmi", "-f", tag], {
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }, 180_000);
});
