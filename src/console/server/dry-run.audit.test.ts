/**
 * Exhaustive dry-run / preview audit across `src/console` (console §10.5).
 *
 * Reversibility dual-test (stub irreversible effects AND isolate writes with
 * explicit refusal) is required only for affordances that execute work under
 * dry-run. Locale / template "preview" and metadata-only `dryRun` flags are
 * not that class.
 */

import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const CONSOLE_ROOT = `${import.meta.dir}/..`;

/** Server flows that offer true dry-run / write-isolated preview. */
const EXPECTED_DRY_RUN_FLOWS = [
  "console.signals.dryRunReplay",
  "console.store.preview",
  "console.store.edit", // dryRun:true branch
] as const;

/**
 * Collect TypeScript sources under `src/console`.
 *
 * @param dir - Directory
 */
async function collectSources(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "node_modules" || entry.name === ".git") {
        continue;
      }
      out.push(...(await collectSources(path)));
      continue;
    }
    if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      out.push(path);
    }
  }
  return out;
}

describe("console dry-run / preview audit", () => {
  test("withDryRun is only used by Signals + Store (server)", async () => {
    const files = await collectSources(CONSOLE_ROOT);
    const hits: string[] = [];
    for (const file of files) {
      const text = await Bun.file(file).text();
      if (!text.includes("withDryRun")) continue;
      // Kernel re-export / type-only mentions in UI comments are fine to list.
      hits.push(file.replace(`${CONSOLE_ROOT}/`, "src/console/"));
    }
    // Server dual-test sites + kernel import sites under console/server.
    const allowed = hits.filter(
      (h) =>
        h.includes("store.ts") ||
        h.includes("store.test.ts") ||
        h.includes("flows.ts") ||
        h.includes("dry-run"),
    );
    const unexpected = hits.filter((h) => !allowed.includes(h));
    // UI may mention withDryRun in comments / client types — flag only
    // executable imports of the kernel helper outside Signals/Store server.
    const executable = unexpected.filter((h) => {
      // Already filtered .test.ts; allow client type fields named dryRun.
      return h.includes("/server/");
    });
    expect(executable).toEqual([]);
  });

  test("dry-run / preview affordances that mutate are dual-tested", async () => {
    const storeTest = await Bun.file(`${import.meta.dir}/store.test.ts`).text();
    expect(storeTest).toContain("preview dual test (withDryRun)");
    expect(storeTest).toContain("DryRunWriteIsolationError");

    const signalIsolation = await Bun.file(
      `${import.meta.dir}/../../elements/signal/dry-run-write-isolation.test.ts`,
    ).text();
    expect(signalIsolation).toContain("dry-run replay — write isolation");

    const signalStub = await Bun.file(
      `${import.meta.dir}/../../elements/signal/dry-run-replay.test.ts`,
    ).text();
    expect(signalStub.length).toBeGreaterThan(0);

    const flows = await Bun.file(`${import.meta.dir}/flows.ts`).text();
    for (const name of EXPECTED_DRY_RUN_FLOWS) {
      expect(flows).toContain(name);
    }
  });

  test("Channels preview is locale template rendering, not dry-run mutation", async () => {
    const flows = await Bun.file(`${import.meta.dir}/flows.ts`).text();
    const previewIdx = flows.indexOf('flow("console.channel.preview"');
    expect(previewIdx).toBeGreaterThan(0);
    const slice = flows.slice(previewIdx, previewIdx + 800);
    expect(slice).not.toContain("withDryRun");
    expect(slice).toContain("state.previewChannel");
  });

  test("Traces replay delegates to runReplay (oke replay), not a log-only stub", async () => {
    const flows = await Bun.file(`${import.meta.dir}/flows.ts`).text();
    const idx = flows.indexOf('flow("console.traces.replay"');
    expect(idx).toBeGreaterThan(0);
    const slice = flows.slice(idx, idx + 1_800);
    expect(slice).toContain("runReplay");
    expect(slice).toContain("eventHasIrreversible");
    // Kernel withDryRun stays inside cli/replay — Console flow must not call it directly.
    expect(slice).not.toContain("withDryRun");
  });
});
