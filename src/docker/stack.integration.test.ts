/**
 * Integration: generated compose brings up postgres; app URL talks to it.
 *
 * Opt-in via `OKE_TEST_DOCKER=1` plus a live Docker daemon. Never an empty pass.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveInfrastructure, formatStackEnv, writeDerivedFiles } from "./index.ts";

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
      ? "skip: docker postgres stack e2e (docker daemon not available)"
      : "skip: docker postgres stack e2e (OKE_TEST_DOCKER≠1)",
  );
}
const live = DOCKER ? test : test.skip;

describe("oke dev --docker postgres integration", () => {
  live(
    "compose brings up postgres and the app talks to it",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "oke-stack-pg-"));
      const dockerDir = join(dir, "docker");
      const project = `oke-pg-${Date.now()}`;
      try {
        const derived = deriveInfrastructure({
          images: { "store.sql": "postgres:18-alpine" },
          credentials: {
            "store.sql": {
              user: "oke",
              password: "stack-integration-pass",
              database: "oke",
            },
          },
          app: "stacktest",
          host: "127.0.0.1",
          includeApp: false,
          composeDir: "docker",
        });
        await writeDerivedFiles(derived, dockerDir, {
          writeStackEnv: true,
        });

        // Infra-only: network + role compose (no app build).
        const composeFiles = ["compose.yml", "compose.store.sql.yml"];
        const up = Bun.spawn(
          [
            "docker",
            "compose",
            "-p",
            project,
            ...composeFiles.flatMap((f) => ["-f", f]),
            "up",
            "-d",
          ],
          {
            cwd: dockerDir,
            stdout: "pipe",
            stderr: "pipe",
            env: {
              ...process.env,
              ...derived.stackEnv,
            },
          },
        );
        const [upOut, upErr, upCode] = await Promise.all([
          new Response(up.stdout).text(),
          new Response(up.stderr).text(),
          up.exited,
        ]);
        expect(upCode).toBe(0);
        if (upCode !== 0) console.error(upOut, upErr);

        // Wait for healthy
        let healthy = false;
        for (let i = 0; i < 40; i++) {
          const ps = Bun.spawn(
            [
              "docker",
              "compose",
              "-p",
              project,
              ...composeFiles.flatMap((f) => ["-f", f]),
              "ps",
              "--format",
              "json",
            ],
            { cwd: dockerDir, stdout: "pipe", stderr: "pipe" },
          );
          const text = await new Response(ps.stdout).text();
          await ps.exited;
          if (/healthy/i.test(text)) {
            healthy = true;
            break;
          }
          await Bun.sleep(500);
        }
        expect(healthy).toBe(true);

        const url = derived.stackEnv.DATABASE_URL!;
        // App talks to postgres via recipe URL (Bun.SQL) — kernel never sees env-var names.
        const sql = new Bun.SQL(url);
        try {
          const rows = (await sql`select 1::int as n`) as Array<{ n: number }>;
          expect(rows[0]?.n).toBe(1);
        } finally {
          await sql.close();
        }

        // Prove credentials live in docker/.env.docker, not YAML.
        const yml = await Bun.file(join(dockerDir, "compose.store.sql.yml")).text();
        expect(yml).not.toContain("stack-integration-pass");
        expect(formatStackEnv(derived.stackEnv)).toContain("stack-integration-pass");
        expect(await Bun.file(join(dockerDir, ".env.docker")).exists()).toBe(true);
      } finally {
        await Bun.spawn(
          [
            "docker",
            "compose",
            "-p",
            project,
            "-f",
            "compose.yml",
            "-f",
            "compose.store.sql.yml",
            "down",
            "-v",
          ],
          { cwd: dockerDir, stdout: "pipe", stderr: "pipe" },
        ).exited.catch(() => {});
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
    120_000,
  );
});
