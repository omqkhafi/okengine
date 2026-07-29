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
  test("local → sqlite, docker → postgresql", async () => {
    const config = {
      drivers: {
        store: { sql: { local: "sqlite", docker: "postgres", prod: "postgres", test: "memory" } },
      },
    } as never;
    expect(sqlDialectForEnv(config, "local").dialect).toBe("sqlite");
    expect(sqlDialectForEnv(config, "docker").dialect).toBe("postgresql");
  });

  test("missing config → sqlite default", () => {
    expect(sqlDialectForEnv(null, "local").dialect).toBe("sqlite");
  });
});

describe("syncDevSchema", () => {
  test("local: ensures drizzle config, emits, pushes with env", async () => {
    const dir = await tempDir();
    const calls: { cwd: string; env: ConfigEnv }[] = [];
    const result = await syncDevSchema(dir, "local", {
      write: () => {},
      pushFn: async (cwd, env) => {
        calls.push({ cwd, env });
        return 0;
      },
    });
    expect(result.dialect).toBe("sqlite");
    expect(result.pushed).toBe(true);
    expect(calls).toEqual([{ cwd: dir, env: "local" }]);
    expect(await Bun.file(join(dir, "drizzle.config.ts")).exists()).toBe(true);
  });

  test("push failure surfaces code without throwing", async () => {
    const dir = await tempDir();
    const result = await syncDevSchema(dir, "local", {
      write: () => {},
      pushFn: async () => 1,
    });
    expect(result.pushed).toBe(false);
    expect(result.code).toBe(1);
  });
});
