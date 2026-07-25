/**
 * Client runtime budget — AGENTS.md / unified-theory §24.
 * Limit: < 3 kB gzipped (minified bundle).
 */

import { describe, expect, test } from "bun:test";
import { CLIENT_BUDGET_BYTES } from "../release/limits.ts";
import { measureClientGzipBytes } from "../release/measure.ts";

describe("client bundle budget", () => {
  test(`okengine/client < ${CLIENT_BUDGET_BYTES} bytes gzipped`, async () => {
    const size = await measureClientGzipBytes();
    console.log(`client bundle gzip=${size} budget=${CLIENT_BUDGET_BYTES}`);
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(CLIENT_BUDGET_BYTES);
  });
});
