/**
 * Skyport `oke docker` smoke — derive Dockerfile + compose from oke.config.ts.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDockerDerive } from "../../../src/cli/docker.ts";

const skyportRoot = join(import.meta.dir, "..");

describe("skyport oke docker", () => {
  test("derives Dockerfile and role compose from oke.config.ts", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "oke-skyport-docker-"));
    try {
      const logs: string[] = [];
      const { code, result } = await runDockerDerive({
        cwd: skyportRoot,
        outDir,
        write: (t) => logs.push(t),
      });
      expect(code).toBe(0);
      expect(result).toBeDefined();
      expect(await Bun.file(join(outDir, "Dockerfile")).exists()).toBe(true);
      expect(await Bun.file(join(outDir, "compose.store.sql.yml")).exists()).toBe(true);
      expect(await Bun.file(join(outDir, "compose.store.kv.yml")).exists()).toBe(true);
      expect(logs.join("")).toContain("oke docker: wrote");
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
