import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDevAuthSecret } from "./dev-auth-secret.ts";

describe("ensureDevAuthSecret", () => {
  const dirs: string[] = [];
  const prev = process.env.OKE_AUTH_SECRET;

  afterEach(async () => {
    if (prev === undefined) delete process.env.OKE_AUTH_SECRET;
    else process.env.OKE_AUTH_SECRET = prev;
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  test("reuses process.env and does not write a file", async () => {
    process.env.OKE_AUTH_SECRET = "from-env";
    const dir = await mkdtemp(join(tmpdir(), "oke-auth-secret-"));
    dirs.push(dir);
    expect(await ensureDevAuthSecret(dir)).toBe("from-env");
    expect(await Bun.file(join(dir, ".env.local")).exists()).toBe(false);
  });

  test("reads .env.local before minting", async () => {
    delete process.env.OKE_AUTH_SECRET;
    const dir = await mkdtemp(join(tmpdir(), "oke-auth-secret-"));
    dirs.push(dir);
    await Bun.write(
      join(dir, ".env.local"),
      "DATABASE_URL=postgres://localhost/oke\nOKE_AUTH_SECRET=from-file\n",
    );
    expect(await ensureDevAuthSecret(dir)).toBe("from-file");
  });

  test("mints once and appends to .env.local", async () => {
    delete process.env.OKE_AUTH_SECRET;
    const dir = await mkdtemp(join(tmpdir(), "oke-auth-secret-"));
    dirs.push(dir);
    await Bun.write(join(dir, ".env.local"), "DATABASE_URL=postgres://localhost/oke\n");
    const first = await ensureDevAuthSecret(dir);
    expect(first.startsWith("oke_dev_")).toBe(true);
    const text = await readFile(join(dir, ".env.local"), "utf8");
    expect(text).toContain(`OKE_AUTH_SECRET=${first}`);
    expect(text.startsWith("DATABASE_URL=")).toBe(true);
    delete process.env.OKE_AUTH_SECRET;
    expect(await ensureDevAuthSecret(dir)).toBe(first);
  });
});
