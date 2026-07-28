/**
 * `.oke/mode` persistence and prompt gating.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDevMode, readDevMode, shouldAskDevMode, writeDevMode } from "./dev-mode.ts";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "oke-mode-"));
  dirs.push(dir);
  return dir;
}

describe("dev-mode", () => {
  test("parseDevMode accepts local|docker only", () => {
    expect(parseDevMode("local")).toBe("local");
    expect(parseDevMode(" docker \n")).toBe("docker");
    expect(parseDevMode("stack")).toBeNull();
    expect(parseDevMode(undefined)).toBeNull();
  });

  test("read/write round-trip", async () => {
    const dir = await tempDir();
    expect(await readDevMode(dir)).toBeNull();
    await writeDevMode(dir, "docker");
    expect(await readDevMode(dir)).toBe("docker");
  });

  test("shouldAskDevMode: TTY + unset → ask; non-TTY → never", () => {
    expect(shouldAskDevMode({ saved: null, explicit: false, stdinIsTTY: true })).toBe(true);
    expect(shouldAskDevMode({ saved: null, explicit: false, stdinIsTTY: false })).toBe(false);
    expect(shouldAskDevMode({ saved: null, explicit: false, stdinIsTTY: undefined })).toBe(false);
    expect(shouldAskDevMode({ saved: "local", explicit: false, stdinIsTTY: true })).toBe(false);
    expect(shouldAskDevMode({ saved: null, explicit: true, stdinIsTTY: true })).toBe(false);
  });
});
