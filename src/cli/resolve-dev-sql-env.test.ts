/**
 * Active SQL env resolution — Docker-first (`dev` default).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDevSqlEnv } from "./resolve-dev-sql-env.ts";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "oke-sqlenv-"));
  dirs.push(dir);
  return dir;
}

describe("resolveDevSqlEnv", () => {
  test("defaults to dev (Docker-first)", async () => {
    const dir = await tempDir();
    expect(await resolveDevSqlEnv(dir)).toBe("dev");
  });

  test("explicit env override wins", async () => {
    const dir = await tempDir();
    expect(await resolveDevSqlEnv(dir, { env: "test" })).toBe("test");
    expect(await resolveDevSqlEnv(dir, { env: "dev" })).toBe("dev");
  });

  test("docker flag is ignored (always dev unless env set)", async () => {
    const dir = await tempDir();
    expect(await resolveDevSqlEnv(dir, { docker: true })).toBe("dev");
    expect(await resolveDevSqlEnv(dir, { docker: false })).toBe("dev");
  });
});
