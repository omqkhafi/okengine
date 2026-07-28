/**
 * `.oke/mode` preference helpers.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseDevMode,
  readDevMode,
  shouldAskDevMode,
  writeDevMode,
} from "./dev-mode.ts";

describe("dev-mode", () => {
  test("parseDevMode accepts local|docker", () => {
    expect(parseDevMode("local")).toBe("local");
    expect(parseDevMode(" docker \n")).toBe("docker");
    expect(parseDevMode("stack")).toBeNull();
    expect(parseDevMode("")).toBeNull();
  });

  test("shouldAskDevMode only when TTY + unset + no explicit flag", () => {
    expect(
      shouldAskDevMode({ saved: null, explicit: false, stdinIsTTY: true }),
    ).toBe(true);
    expect(
      shouldAskDevMode({ saved: null, explicit: false, stdinIsTTY: false }),
    ).toBe(false);
    expect(
      shouldAskDevMode({ saved: "local", explicit: false, stdinIsTTY: true }),
    ).toBe(false);
    expect(
      shouldAskDevMode({ saved: null, explicit: true, stdinIsTTY: true }),
    ).toBe(false);
  });

  test("read/write round-trip", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-mode-"));
    expect(await readDevMode(dir)).toBeNull();
    await writeDevMode(dir, "docker");
    expect(await readDevMode(dir)).toBe("docker");
  });
});
