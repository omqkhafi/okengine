/**
 * Client runtime budget — AGENTS.md / unified-theory §24.
 * Limit: gzipped minified bundle under {@link CLIENT_BUDGET_BYTES}.
 */

import { describe, expect, test } from "bun:test";
import { CLIENT_BUDGET_BYTES } from "../release/limits.ts";
import { measureClientBundle } from "../release/measure.ts";

describe("client bundle budget", () => {
  test(`okengine/client entry < ${CLIENT_BUDGET_BYTES} bytes gzipped`, async () => {
    const bundle = await measureClientBundle();
    console.log(
      `client entry gzip=${bundle.entryGzipBytes} full gzip=${bundle.fullGzipBytes} budget=${CLIENT_BUDGET_BYTES}`,
    );
    expect(bundle.entryGzipBytes).toBeGreaterThan(0);
    expect(bundle.entryGzipBytes).toBeLessThan(CLIENT_BUDGET_BYTES);
    expect(bundle.fullGzipBytes).toBeGreaterThan(bundle.entryGzipBytes);
    expect(bundle.entrySource).not.toContain("text/event-stream");
    expect(bundle.entrySource).not.toContain("last-event-id");
  });
});
