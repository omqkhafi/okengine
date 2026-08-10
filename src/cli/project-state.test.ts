/**
 * Tests for durable `.oke/state.json` project markers.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  isProjectSeeded,
  LEGACY_SEEDED_MARKER,
  markProjectSeeded,
  PROJECT_STATE_REL,
  readProjectState,
} from "./project-state.ts";

describe("project-state", () => {
  test("markProjectSeeded writes seededAt under .oke/state.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oke-state-"));
    try {
      expect(await isProjectSeeded(dir)).toBe(false);
      await markProjectSeeded(dir, "2026-01-02T03:04:05.000Z");
      expect(await isProjectSeeded(dir)).toBe(true);
      const state = await readProjectState(dir);
      expect(state.seededAt).toBe("2026-01-02T03:04:05.000Z");
      expect(existsSync(join(dir, PROJECT_STATE_REL))).toBe(true);
      expect(existsSync(join(dir, LEGACY_SEEDED_MARKER))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("migrates legacy .oke/seeded into state.json and removes marker", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oke-state-"));
    try {
      mkdirSync(join(dir, ".oke"), { recursive: true });
      writeFileSync(join(dir, LEGACY_SEEDED_MARKER), "2025-12-01T00:00:00.000Z\n");
      const state = await readProjectState(dir);
      expect(state.seededAt).toBe("2025-12-01T00:00:00.000Z");
      expect(existsSync(join(dir, PROJECT_STATE_REL))).toBe(true);
      expect(existsSync(join(dir, LEGACY_SEEDED_MARKER))).toBe(false);
      const raw = JSON.parse(readFileSync(join(dir, PROJECT_STATE_REL), "utf8")) as {
        seededAt?: string;
      };
      expect(raw.seededAt).toBe("2025-12-01T00:00:00.000Z");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
