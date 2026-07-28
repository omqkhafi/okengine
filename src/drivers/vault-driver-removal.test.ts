/**
 * Gate: the remote KV vault driver formerly named after that project is fully
 * removed — no residual references in the tracked tree (`src/`, `templates/`,
 * `docs/`, `site/`, …).
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

/** Forbidden token, split so this file itself does not contain the contiguous string. */
const FORBIDDEN = ["open", "bao"].join("");

describe("vault driver removal gate", () => {
  test("tracked tree has zero matches for the removed driver id", () => {
    const proc = Bun.spawnSync(
      ["git", "grep", "-i", "-n", "--", FORBIDDEN],
      {
        cwd: ROOT,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    // git grep exits 1 when there are no matches.
    if (proc.exitCode === 1) {
      expect(proc.stdout.toString()).toBe("");
      return;
    }
    const hits = proc.stdout.toString().trim();
    expect(hits).toBe("");
    expect(proc.exitCode).toBe(1);
  });
});
