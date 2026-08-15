/**
 * drizzle-kit env resolution — dialect from configured driver, not URL sniffing.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
      sql: { dev: "postgres", test: "pglite", prod: "postgres" },
    },
  },
} as unknown as OkeConfig;

describe("resolveDrizzleKitEnv", () => {
  test("test env → postgresql dialect (pglite)", async () => {
    const dir = await tempDir();
    const ctx = await resolveDrizzleKitEnv(dir, dualConfig, "test");
    expect(ctx.dialect).toBe("postgresql");
    expect(ctx.overlay.OKE_DRIZZLE_DIALECT).toBe("postgresql");
  });

  test("dev env → postgresql dialect + DATABASE_URL from compose env", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, ".env.local"), "DATABASE_URL=postgres://u:p@127.0.0.1:5432/oke\n");
    const prevDb = process.env["DATABASE_URL"];
    delete process.env["DATABASE_URL"];
    try {
      const ctx = await resolveDrizzleKitEnv(dir, dualConfig, "dev");
      expect(ctx.dialect).toBe("postgresql");
      expect(ctx.overlay.OKE_DRIZZLE_DIALECT).toBe("postgresql");
      expect(ctx.overlay.DATABASE_URL).toBe("postgres://u:p@127.0.0.1:5432/oke");
      expect(ctx.overlay.OKE_SQLITE_URL).toBeUndefined();
    } finally {
      if (prevDb === undefined) delete process.env["DATABASE_URL"];
      else process.env["DATABASE_URL"] = prevDb;
    }
  });

  test("dev dialect is postgresql even when DATABASE_URL unset (no URL guessing)", async () => {
    const dir = await tempDir();
    const ctx = await resolveDrizzleKitEnv(dir, dualConfig, "dev");
    expect(ctx.dialect).toBe("postgresql");
  });

  test("unsupported driver id errors clearly", async () => {
    const dir = await tempDir();
    const bad = { drivers: { store: { sql: { test: "memory" } } } } as unknown as OkeConfig;
    await expect(resolveDrizzleKitEnv(dir, bad, "test")).rejects.toThrow(/not supported/);
  });
});

describe("applyComposeEnvToProcess", () => {
  test("fills unset keys from .env.local without overwriting", async () => {
    const dir = await tempDir();
    await writeFile(
      join(dir, ".env.local"),
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
