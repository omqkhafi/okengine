/**
 * Client runtime budget — AGENTS.md / unified-theory §24.
 * Limit: < 3 kB gzipped (minified bundle).
 */

import { describe, expect, test } from "bun:test";

/** Budget from AGENTS.md. */
export const CLIENT_BUDGET_BYTES = 3 * 1024;

describe("client bundle budget", () => {
  test(`okengine/client < ${CLIENT_BUDGET_BYTES} bytes gzipped`, async () => {
    // Dedicated entry — `index.ts` re-exports alone can minify to aliases under
    // `"sideEffects": false`; this keeps the runtime graph in the artifact.
    const entry = `${import.meta.dir}/budget-entry.ts`;
    const result = await Bun.build({
      entrypoints: [entry],
      minify: true,
      target: "browser",
      format: "esm",
    });

    expect(result.success).toBe(true);
    const artifact = result.outputs[0];
    expect(artifact).toBeDefined();
    const raw = await artifact!.arrayBuffer();
    const gz = Bun.gzipSync(new Uint8Array(raw));
    const size = gz.byteLength;

    console.log(
      `client bundle raw=${raw.byteLength} gzip=${size} budget=${CLIENT_BUDGET_BYTES}`,
    );
    expect(size).toBeLessThan(CLIENT_BUDGET_BYTES);
  });
});
