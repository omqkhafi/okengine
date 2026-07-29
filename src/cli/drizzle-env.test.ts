/**
 * drizzle-kit env resolution — dialect from configured driver, not URL sniffing.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OkeConfig } from "../config/index.ts";
import { resolveDrizzleKitEnv } from "./drizzle-env.ts";

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
    const ctx = await resolveDrizzleKitEnv(dir, dualConfig, "docker");
    expect(ctx.dialect).toBe("postgresql");
    expect(ctx.overlay.OKE_DRIZZLE_DIALECT).toBe("postgresql");
    expect(ctx.overlay.DATABASE_URL).toBe("postgres://u:p@127.0.0.1:5432/oke");
    expect(ctx.overlay.OKE_SQLITE_URL).toBeUndefined();
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
