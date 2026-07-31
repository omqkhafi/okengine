/**
 * Local Meilisearch lifecycle — persisted master key material and fail-loud
 * binary resolution. Never spawns a real server here.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureMasterKey,
  MEILISEARCH_STATE_DIR_REL,
  MeilisearchLocalError,
  startLocalMeilisearch,
} from "./meilisearch-local.ts";

const dirs: string[] = [];

function tempStateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "oke-meili-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("ensureMasterKey", () => {
  test("generates once, persists 0600, reuses on next call", () => {
    const stateDir = tempStateDir();
    const first = ensureMasterKey(stateDir);
    const second = ensureMasterKey(stateDir);
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(32);
    const keyPath = join(stateDir, "master.key");
    expect(statSync(keyPath).mode & 0o777).toBe(0o600);
    expect(statSync(stateDir).mode & 0o777).toBe(0o700);
    expect(readFileSync(keyPath, "utf8").trim()).toBe(first);
    // No leftover temp files.
    expect(readdirSync(stateDir).filter((f) => f.includes(".tmp-"))).toHaveLength(0);
  });

  test("a too-short persisted key fails loud", () => {
    const stateDir = tempStateDir();
    const keyPath = join(stateDir, "master.key");
    // Write a weak key directly (bypasses the writer) to simulate corruption.
    writeFileSync(keyPath, "short\n");
    expect(() => ensureMasterKey(stateDir)).toThrow(MeilisearchLocalError);
  });
});

describe("startLocalMeilisearch", () => {
  test("missing binary fails loud with an install hint (never silent memory)", async () => {
    await expect(
      startLocalMeilisearch({
        binary: "meilisearch-definitely-not-on-path-xyz",
        stateDir: tempStateDir(),
      }),
    ).rejects.toThrow(/not found on PATH|never auto-downloads/i);
  });

  test("state dir rel lives under .oke", () => {
    expect(MEILISEARCH_STATE_DIR_REL).toBe(join(".oke", "meilisearch"));
  });
});
