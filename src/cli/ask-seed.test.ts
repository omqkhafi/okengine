/**
 * Tests for the one-shot seed prompt after `oke db push`.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { maybeAskSeed } from "./ask-seed.ts";
import { PROJECT_STATE_REL } from "./project-state.ts";

describe("maybeAskSeed", () => {
  test("skips when non-TTY", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ask-seed-"));
    try {
      mkdirSync(join(dir, "src", "db", "seed"), { recursive: true });
      writeFileSync(join(dir, "src", "db", "seed", "index.ts"), "export default {};\n");
      let seeded = false;
      await maybeAskSeed({
        cwd: dir,
        env: "test",
        stdinIsTTY: false,
        confirmFn: async () => true,
        seedFn: async () => {
          seeded = true;
          return 0;
        },
      });
      expect(seeded).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("re-asks when the seed identity changes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ask-seed-"));
    try {
      mkdirSync(join(dir, "src", "db", "seed"), { recursive: true });
      writeFileSync(join(dir, "src", "db", "seed", "index.ts"), "export default {};\n");
      mkdirSync(join(dir, ".oke"), { recursive: true });
      writeFileSync(
        join(dir, PROJECT_STATE_REL),
        `${JSON.stringify({ seededAt: "2026-01-01T00:00:00.000Z", seed: "notes" }, null, 2)}\n`,
      );
      let calls = 0;
      await maybeAskSeed({
        cwd: dir,
        env: "test",
        stdinIsTTY: true,
        confirmFn: async () => true,
        seedFn: async () => {
          calls += 1;
          return 0;
        },
      });
      expect(calls).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("asks once then writes .oke/state.json seededAt", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ask-seed-"));
    try {
      mkdirSync(join(dir, "src", "db", "seed"), { recursive: true });
      writeFileSync(join(dir, "src", "db", "seed", "index.ts"), "export default {};\n");
      let calls = 0;
      await maybeAskSeed({
        cwd: dir,
        env: "test",
        stdinIsTTY: true,
        confirmFn: async () => true,
        seedFn: async () => {
          calls += 1;
          return 0;
        },
      });
      expect(calls).toBe(1);
      expect(existsSync(join(dir, PROJECT_STATE_REL))).toBe(true);

      await maybeAskSeed({
        cwd: dir,
        env: "test",
        stdinIsTTY: true,
        confirmFn: async () => true,
        seedFn: async () => {
          calls += 1;
          return 0;
        },
      });
      expect(calls).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
