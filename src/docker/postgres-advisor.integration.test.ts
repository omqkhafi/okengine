/**
 * Integration: opt-in postgres-advisor image builds and Index Advisor works.
 *
 * Opt-in via `OKE_TEST_DOCKER=1` plus a live Docker daemon. Never an empty pass.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deriveInfrastructure,
  POSTGRES_ADVISOR_DOCKERFILE,
  POSTGRES_ADVISOR_IMAGE,
  writeDerivedFiles,
} from "./index.ts";

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
      ? "skip: postgres-advisor e2e (docker daemon not available)"
      : "skip: postgres-advisor e2e (OKE_TEST_DOCKER≠1)",
  );
}
const live = DOCKER ? test : test.skip;

describe("postgres-advisor integration", () => {
  live(
    "builds the advisor image and index_advisor returns CREATE INDEX",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "oke-pg-advisor-"));
      const imageTag = `oke-postgres-advisor-test:${Date.now()}`;
      const container = `oke-pg-advisor-${Date.now()}`;
      try {
        const derived = deriveInfrastructure({
          images: { "store.sql": POSTGRES_ADVISOR_IMAGE },
          credentials: {
            "store.sql": { user: "oke", password: "advisor-test-pw", database: "oke" },
          },
        });
        await writeDerivedFiles(derived, dir);
        const dockerfile = join(dir, POSTGRES_ADVISOR_DOCKERFILE);
        const build = Bun.spawnSync(["docker", "build", "-t", imageTag, "-f", dockerfile, dir], {
          stdout: "pipe",
          stderr: "pipe",
        });
        expect(build.exitCode).toBe(0);

        const run = Bun.spawnSync(
          [
            "docker",
            "run",
            "-d",
            "--name",
            container,
            "-e",
            "POSTGRES_PASSWORD=advisor-test-pw",
            "-e",
            "POSTGRES_USER=oke",
            "-e",
            "POSTGRES_DB=oke",
            imageTag,
            "postgres",
            "-c",
            "shared_preload_libraries=pg_stat_statements",
          ],
          { stdout: "pipe", stderr: "pipe" },
        );
        expect(run.exitCode).toBe(0);

        let ready = false;
        for (let i = 0; i < 40; i++) {
          const ping = Bun.spawnSync(
            ["docker", "exec", container, "pg_isready", "-U", "oke", "-d", "oke"],
            { stdout: "pipe", stderr: "pipe" },
          );
          if (ping.exitCode === 0) {
            ready = true;
            break;
          }
          await Bun.sleep(500);
        }
        expect(ready).toBe(true);

        const ext = Bun.spawnSync(
          [
            "docker",
            "exec",
            container,
            "psql",
            "-U",
            "oke",
            "-d",
            "oke",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            "CREATE EXTENSION index_advisor CASCADE;",
          ],
          { stdout: "pipe", stderr: "pipe" },
        );
        expect(ext.exitCode).toBe(0);

        const setup = Bun.spawnSync(
          [
            "docker",
            "exec",
            container,
            "psql",
            "-U",
            "oke",
            "-d",
            "oke",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            "CREATE TABLE bookings (id int, email text);",
          ],
          { stdout: "pipe", stderr: "pipe" },
        );
        expect(setup.exitCode).toBe(0);

        const advise = Bun.spawnSync(
          [
            "docker",
            "exec",
            container,
            "psql",
            "-U",
            "oke",
            "-d",
            "oke",
            "-v",
            "ON_ERROR_STOP=1",
            "-t",
            "-A",
            "-c",
            "SELECT index_statements FROM index_advisor('SELECT * FROM bookings WHERE email = $1');",
          ],
          { stdout: "pipe", stderr: "pipe" },
        );
        expect(advise.exitCode).toBe(0);
        const out = new TextDecoder().decode(advise.stdout);
        expect(out.toLowerCase()).toContain("create index");
      } finally {
        Bun.spawnSync(["docker", "rm", "-f", container], { stdout: "pipe", stderr: "pipe" });
        Bun.spawnSync(["docker", "rmi", "-f", imageTag], { stdout: "pipe", stderr: "pipe" });
        await rm(dir, { recursive: true, force: true });
      }
    },
    600_000,
  );
});
