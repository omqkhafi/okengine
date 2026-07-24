/**
 * Save-as-test emits a passing bun test file (console §9.2).
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitSaveAsTest, writeSaveAsTest } from "./save-as-test.ts";

describe("save-as-test", () => {
  test("emits a bun test source with request/response assertions", () => {
    const src = emitSaveAsTest({
      flowId: "bookings.create",
      request: { flightId: "SK1", seats: 2 },
      response: { id: "b_1" },
      asUserId: "user_1",
    });
    expect(src).toContain('from "bun:test"');
    expect(src).toContain("bookings.create");
    expect(src).toContain('"flightId": "SK1"');
    expect(src).toContain('"id": "b_1"');
    expect(src).toContain("asUserId");
  });

  test("written file passes bun test", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-save-as-test-"));
    try {
      const { path } = await writeSaveAsTest(dir, {
        flowId: "bookings.create",
        request: { flightId: "SK1", seats: 2 },
        response: { id: "b_1" },
      });
      const proc = Bun.spawnSync(["bun", "test", path], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if (proc.exitCode !== 0) {
        console.error(proc.stdout.toString());
        console.error(proc.stderr.toString());
      }
      expect(proc.exitCode).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
