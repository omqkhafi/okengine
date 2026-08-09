/**
 * Mode-switch schema sync pipeline — ensure → emit → push, no data copy.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConfigEnv } from "../config/index.ts";
import { sqlDialectForEnv, syncDevSchema } from "./dev-schema-sync.ts";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "oke-sync-"));
  dirs.push(dir);
  return dir;
}

describe("sqlDialectForEnv", () => {
  test("test → postgresql (pglite), dev → postgresql", async () => {
    const config = {
      drivers: {
        store: { sql: { dev: "postgres", test: "pglite", prod: "postgres" } },
      },
    } as never;
    expect(sqlDialectForEnv(config, "test").dialect).toBe("postgresql");
    expect(sqlDialectForEnv(config, "dev").dialect).toBe("postgresql");
  });

  test("missing config → postgresql default", () => {
    expect(sqlDialectForEnv(null, "test").dialect).toBe("postgresql");
  });
});

describe("syncDevSchema", () => {
  test("test: ensures drizzle config, emits, pushes with env", async () => {
    const dir = await tempDir();
    const calls: { cwd: string; env: ConfigEnv }[] = [];
    const result = await syncDevSchema(dir, "test", {
      write: () => {},
      pushFn: async (cwd, env) => {
        calls.push({ cwd, env });
        return 0;
      },
    });
    expect(result.dialect).toBe("postgresql");
    expect(result.pushed).toBe(true);
    expect(calls).toEqual([{ cwd: dir, env: "test" }]);
    expect(await Bun.file(join(dir, "drizzle.config.ts")).exists()).toBe(true);
  });

  test("push failure surfaces code without throwing", async () => {
    const dir = await tempDir();
    const result = await syncDevSchema(dir, "test", {
      write: () => {},
      pushFn: async () => 1,
    });
    expect(result.pushed).toBe(false);
    expect(result.code).toBe(1);
  });
});
