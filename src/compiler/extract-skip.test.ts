/**
 * Manifest extract must not walk `node_modules` — Windows glob paths use `\`
 * and a naive `includes("node_modules/")` miss lets framework fixtures throw
 * during extract, which Docker-first `oke dev` surfaces as **OKE1020**.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractManifest } from "./extract.ts";

describe("extractManifest — skip dependency trees", () => {
  test("does not parse node_modules even when a poison file would fail extract", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-extract-skip-"));
    try {
      await mkdir(join(dir, "src/flows/main"), { recursive: true });
      await writeFile(
        join(dir, "src/flows/main/health.ts"),
        `
import { on, flow, http } from "okengine/http";
export const health = on(
  http.get("/health").public(),
  flow({ do: () => ({ ok: true as const }) }),
);
`,
      );
      await mkdir(join(dir, "node_modules/okengine"), { recursive: true });
      // Nameless Signal consumer — **OKE1072** if this file is scanned.
      await writeFile(
        join(dir, "node_modules/okengine/poison.ts"),
        `
import { on, flow, signal } from "okengine";
export const inbound = on(signal.once("x"), flow({ do: () => ({}) }));
`,
      );
      const manifest = await extractManifest({ rootDir: dir });
      expect(manifest.flows?.["main.health"]).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
