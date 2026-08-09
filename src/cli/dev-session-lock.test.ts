import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearDevSessionLock,
  isPidAlive,
  parseDevSessionLock,
  readDevSessionLock,
  resolveDevOwnership,
  writeDevSessionLock,
  type DevSessionLock,
} from "./dev-session-lock.ts";

describe("dev-session-lock", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  test("parseDevSessionLock accepts well-formed payloads", () => {
    const lock: DevSessionLock = {
      pid: 1,
      startedAt: "2026-01-01T00:00:00.000Z",
      cwd: "/tmp/app",
      ports: { app: 6530, console: 6533, mcp: 6535, docsMcp: 6536 },
    };
    expect(parseDevSessionLock(lock)).toEqual(lock);
    expect(parseDevSessionLock(null)).toBeNull();
    expect(parseDevSessionLock({ pid: "x" })).toBeNull();
  });

  test("isPidAlive recognizes this process", () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(999_999_999)).toBe(false);
  });

  test("write/read/clear round-trip", async () => {
    dir = await mkdtemp(join(tmpdir(), "oke-dev-lock-"));
    const lock: DevSessionLock = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      cwd: dir,
      ports: { app: 6530, console: 6533, mcp: 6535, docsMcp: 6536 },
    };
    await writeDevSessionLock(dir, lock);
    expect(await readDevSessionLock(dir)).toEqual(lock);
    await clearDevSessionLock(dir);
    expect(await readDevSessionLock(dir)).toBeNull();
  });

  test("resolveDevOwnership: managed when lock pid alive and cwd matches", async () => {
    dir = await mkdtemp(join(tmpdir(), "oke-dev-lock-"));
    await writeDevSessionLock(dir, {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      cwd: dir,
      ports: { app: 6530, console: 6533, mcp: 6535, docsMcp: 6536 },
    });
    const resolved = await resolveDevOwnership(
      dir,
      { app: 6530, console: 6533, mcp: 6535, docsMcp: 6536 },
      async () => false,
    );
    expect(resolved.ownership).toBe("managed");
  });

  test("resolveDevOwnership: external when ports busy without our lock", async () => {
    dir = await mkdtemp(join(tmpdir(), "oke-dev-lock-"));
    const resolved = await resolveDevOwnership(
      dir,
      { app: 6530, console: 6533, mcp: 6535, docsMcp: 6536 },
      async (port) => port === 6530,
    );
    expect(resolved.ownership).toBe("external");
  });

  test("resolveDevOwnership: stopped when free and no lock", async () => {
    dir = await mkdtemp(join(tmpdir(), "oke-dev-lock-"));
    const resolved = await resolveDevOwnership(
      dir,
      { app: 6530, console: 6533, mcp: 6535, docsMcp: 6536 },
      async () => false,
    );
    expect(resolved.ownership).toBe("stopped");
  });

  test("stale lock (dead pid) is cleared and treated as stopped when ports free", async () => {
    dir = await mkdtemp(join(tmpdir(), "oke-dev-lock-"));
    await writeDevSessionLock(dir, {
      pid: 999_999_999,
      startedAt: new Date().toISOString(),
      cwd: dir,
      ports: { app: 6530, console: 6533, mcp: 6535, docsMcp: 6536 },
    });
    const resolved = await resolveDevOwnership(
      dir,
      { app: 6530, console: 6533, mcp: 6535, docsMcp: 6536 },
      async () => false,
    );
    expect(resolved.ownership).toBe("stopped");
    expect(await readDevSessionLock(dir)).toBeNull();
  });
});
