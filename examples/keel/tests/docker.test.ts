/**
 * `oke docker` derive for the keel example.
 * Live compose is opt-in via `OKE_TEST_DOCKER=1` plus a running daemon.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveInfrastructure, writeDerivedFiles } from "../../../src/docker/index.ts";

const IMAGES = {
  "store.sql": "postgres:18-alpine",
  "store.kv": "redis:8-alpine",
  "store.files": "rustfs/rustfs:1.0.0-beta.11",
  "store.index": "getmeili/meilisearch:v1.37",
  "channel.email": "axllent/mailpit:v1.22.3",
} as const;

function dockerAvailable(): boolean {
  try {
    return Bun.spawnSync(["docker", "info"], { stdout: "pipe", stderr: "pipe" }).exitCode === 0;
  } catch {
    return false;
  }
}

const WANT = process.env.OKE_TEST_DOCKER === "1";
const DOCKER = WANT && dockerAvailable();
if (WANT && !DOCKER) {
  console.log("skip: keel docker live (docker daemon not available)");
}

describe("keel docker derive", () => {
  test("compose includes postgres, redis, rustfs, mailpit, meilisearch", () => {
    const result = deriveInfrastructure({
      images: IMAGES,
      app: "keel",
    });
    const yml = result.files.find((f) => f.path.endsWith("docker-compose.yml"))?.content ?? "";
    expect(yml).toContain("postgres:18-alpine");
    expect(yml).toContain("redis:8-alpine");
    expect(yml).toContain("rustfs/rustfs:1.0.0-beta.11");
    expect(yml).toContain("axllent/mailpit:v1.22.3");
    expect(yml).toContain("getmeili/meilisearch:v1.37");
    expect(yml).toContain("oke-keel:latest");
  });
});

const live = DOCKER ? test : test.skip;

describe("keel docker live", () => {
  live(
    "derived compose is valid",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "oke-keel-docker-"));
      try {
        const result = deriveInfrastructure({
          images: IMAGES,
          app: "keel",
          composeDir: ".",
        });
        await writeDerivedFiles(result, dir);
        await writeFile(join(dir, ".env.local"), "OKE_STORE_SQL_PASSWORD=test\n", "utf8");
        const compose = result.files.find((f) => f.path.endsWith("docker-compose.yml"));
        expect(compose).toBeDefined();
        const check = Bun.spawn(["docker", "compose", "-f", join(dir, compose!.path), "config"], {
          cwd: dir,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [out, err, code] = await Promise.all([
          new Response(check.stdout).text(),
          new Response(check.stderr).text(),
          check.exited,
        ]);
        expect(code).toBe(0);
        if (code !== 0) console.error(out, err);
        expect(out).toContain("postgres");
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
    60_000,
  );
});
