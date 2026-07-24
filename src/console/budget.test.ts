/**
 * Console initial bundle budget — < 300 kB gzipped (console §7).
 */

import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** Budget from console.md §7. */
export const CONSOLE_BUDGET_BYTES = 300 * 1024;

const DIST = `${import.meta.dir}/ui/dist`;

/**
 * Sum gzip sizes of initial entry assets (html + js + css, no lazy chunks).
 *
 * @param dir - Vite outDir
 */
async function initialGzipBytes(dir: string): Promise<number> {
  const assetsDir = join(dir, "assets");
  let total = 0;

  const index = Bun.file(join(dir, "index.html"));
  if (await index.exists()) {
    total += Bun.gzipSync(new Uint8Array(await index.arrayBuffer())).byteLength;
  }

  let entries: string[] = [];
  try {
    entries = await readdir(assetsDir);
  } catch {
    return total;
  }

  for (const name of entries) {
    // Initial load only — exclude clearly lazy chunks if named as such.
    if (name.includes("lazy") || name.includes("panel-")) continue;
    if (!/\.(js|css)$/.test(name)) continue;
    const raw = await Bun.file(join(assetsDir, name)).arrayBuffer();
    total += Bun.gzipSync(new Uint8Array(raw)).byteLength;
  }
  return total;
}

describe("console bundle budget", () => {
  test(`initial load < ${CONSOLE_BUDGET_BYTES} bytes gzipped`, async () => {
    const build = Bun.spawnSync(
      ["bunx", "vite", "build", "--config", "src/console/ui/vite.config.ts"],
      {
        cwd: `${import.meta.dir}/../..`,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    if (build.exitCode !== 0) {
      console.error(build.stdout.toString());
      console.error(build.stderr.toString());
    }
    expect(build.exitCode).toBe(0);

    const size = await initialGzipBytes(DIST);
    console.log(
      `console initial gzip=${size} budget=${CONSOLE_BUDGET_BYTES}`,
    );
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(CONSOLE_BUDGET_BYTES);
  });
});
