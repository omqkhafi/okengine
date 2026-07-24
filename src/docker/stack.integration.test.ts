/**
 * Integration: generated compose brings up postgres; app URL talks to it.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deriveInfrastructure,
  formatStackEnv,
  writeDerivedFiles,
} from "./index.ts";

async function dockerAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["docker", "info"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

describe("oke dev --stack postgres integration", () => {
  test("compose brings up postgres and the app talks to it", async () => {
    if (!(await dockerAvailable())) {
      console.warn("skipping: docker daemon not available");
      return;
    }

    const dir = await mkdtemp(join(tmpdir(), "oke-stack-pg-"));
    const project = `oke-pg-${Date.now()}`;
    try {
      const derived = deriveInfrastructure({
        images: { "store.sql": "postgres:16-alpine" },
        credentials: {
          "store.sql": {
            user: "oke",
            password: "stack-integration-pass",
            database: "oke",
          },
        },
        app: "stacktest",
        host: "127.0.0.1",
      });
      await writeDerivedFiles(derived, dir, { writeStackEnv: true });

      // Stack-only: no app service — just the role compose file.
      const composeFiles = ["compose.store.sql.yml"];
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
          cwd: dir,
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
          { cwd: dir, stdout: "pipe", stderr: "pipe" },
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

      // Prove credentials live in .env.stack, not YAML.
      const yml = await Bun.file(join(dir, "compose.store.sql.yml")).text();
      expect(yml).not.toContain("stack-integration-pass");
      expect(formatStackEnv(derived.stackEnv)).toContain(
        "stack-integration-pass",
      );
    } finally {
      await Bun.spawn(
        [
          "docker",
          "compose",
          "-p",
          project,
          "-f",
          "compose.store.sql.yml",
          "down",
          "-v",
        ],
        { cwd: dir, stdout: "pipe", stderr: "pipe" },
      ).exited.catch(() => {});
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }, 120_000);
});
