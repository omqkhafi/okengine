/**
 * drizzle-kit env resolution — dialect from configured driver, not URL sniffing.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OkeConfig } from "../config/index.ts";
import { applyComposeEnvToProcess, resolveDrizzleKitEnv } from "./drizzle-env.ts";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "oke-drizzle-env-"));
  dirs.push(dir);
  return dir;
}

const dualConfig = {
  drivers: {
    store: {
      sql: { local: "sqlite", docker: "postgres", prod: "postgres", test: "memory" },
    },
  },
} as unknown as OkeConfig;

describe("resolveDrizzleKitEnv", () => {
  test("local env → sqlite dialect + sqlite url", async () => {
    const dir = await tempDir();
    const ctx = await resolveDrizzleKitEnv(dir, dualConfig, "local");
    expect(ctx.dialect).toBe("sqlite");
    expect(ctx.overlay.OKE_DRIZZLE_DIALECT).toBe("sqlite");
    expect(ctx.overlay.OKE_SQLITE_URL).toContain(".oke/app.sqlite");
    expect(ctx.overlay.DATABASE_URL).toBeUndefined();
  });

  test("docker env → postgresql dialect + DATABASE_URL from compose env", async () => {
    const dir = await tempDir();
    await mkdir(join(dir, "docker"), { recursive: true });
    await writeFile(
      join(dir, "docker", ".env.docker"),
      "DATABASE_URL=postgres://u:p@127.0.0.1:5432/oke\n",
    );
    const prevDb = process.env["DATABASE_URL"];
    delete process.env["DATABASE_URL"];
    try {
      const ctx = await resolveDrizzleKitEnv(dir, dualConfig, "docker");
      expect(ctx.dialect).toBe("postgresql");
      expect(ctx.overlay.OKE_DRIZZLE_DIALECT).toBe("postgresql");
      expect(ctx.overlay.DATABASE_URL).toBe("postgres://u:p@127.0.0.1:5432/oke");
      expect(ctx.overlay.OKE_SQLITE_URL).toBeUndefined();
    } finally {
      if (prevDb === undefined) delete process.env["DATABASE_URL"];
      else process.env["DATABASE_URL"] = prevDb;
    }
  });

  test("docker dialect is postgresql even when DATABASE_URL unset (no URL guessing)", async () => {
    const dir = await tempDir();
    const ctx = await resolveDrizzleKitEnv(dir, dualConfig, "docker");
    expect(ctx.dialect).toBe("postgresql");
  });

  test("unsupported driver id errors clearly", async () => {
    const dir = await tempDir();
    const bad = { drivers: { store: { sql: { local: "memory" } } } } as unknown as OkeConfig;
    await expect(resolveDrizzleKitEnv(dir, bad, "local")).rejects.toThrow(/not supported/);
  });
});

describe("applyComposeEnvToProcess", () => {
  test("fills unset keys from docker/.env.docker without overwriting", async () => {
    const dir = await tempDir();
    await mkdir(join(dir, "docker"), { recursive: true });
    await writeFile(
      join(dir, "docker", ".env.docker"),
      "DATABASE_URL=postgres://u:p@127.0.0.1:5432/oke\nREDIS_URL=redis://127.0.0.1:6379\n",
    );
    const prevDb = process.env["DATABASE_URL"];
    const prevRedis = process.env["REDIS_URL"];
    delete process.env["DATABASE_URL"];
    process.env["REDIS_URL"] = "redis://already-set";
    try {
      const applied = await applyComposeEnvToProcess(dir);
      expect(applied).toContain("DATABASE_URL");
      expect(applied).not.toContain("REDIS_URL");
      expect(process.env["DATABASE_URL"]).toBe("postgres://u:p@127.0.0.1:5432/oke");
      expect(process.env["REDIS_URL"]).toBe("redis://already-set");
    } finally {
      if (prevDb === undefined) delete process.env["DATABASE_URL"];
      else process.env["DATABASE_URL"] = prevDb;
      if (prevRedis === undefined) delete process.env["REDIS_URL"];
      else process.env["REDIS_URL"] = prevRedis;
    }
  });
});
