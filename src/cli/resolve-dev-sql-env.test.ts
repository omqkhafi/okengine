/**
 * Active SQL env resolution from `.oke/mode` / session overrides.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDevMode } from "./dev-mode.ts";
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
  test("defaults to local when nothing set", async () => {
    const dir = await tempDir();
    expect(await resolveDevSqlEnv(dir)).toBe("local");
  });

  test("explicit env override wins", async () => {
    const dir = await tempDir();
    await writeDevMode(dir, "local");
    expect(await resolveDevSqlEnv(dir, { env: "docker" })).toBe("docker");
  });

  test("session docker flag wins over saved mode", async () => {
    const dir = await tempDir();
    await writeDevMode(dir, "local");
    expect(await resolveDevSqlEnv(dir, { docker: true })).toBe("docker");
    expect(await resolveDevSqlEnv(dir, { docker: false })).toBe("local");
  });

  test("reads saved .oke/mode", async () => {
    const dir = await tempDir();
    await writeDevMode(dir, "docker");
    expect(await resolveDevSqlEnv(dir)).toBe("docker");
  });
});
