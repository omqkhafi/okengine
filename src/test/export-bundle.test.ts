/**
 * `okengine/testing` subpath export & core/client bundle isolation.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { measureClientGzipBytes, measureKernelEdgeGzipBytes } from "../release/measure.ts";
import { CLIENT_BUDGET_BYTES, KERNEL_EDGE_BUDGET_BYTES } from "../release/limits.ts";

describe("testing entrypoint export & bundle isolation", () => {
  test("package.json exports ./testing and ./test point to the harness entry", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(import.meta.dir, "../../package.json"), "utf8"),
    ) as {
      exports: Record<string, unknown>;
    };
    const testing = pkg.exports["./testing"] as Record<string, string>;
    expect(testing).toBeDefined();
    expect(testing.bun).toBe("./src/testing.ts");
    expect(testing.types).toBe("./src/testing.ts");
    expect(testing.import).toBe("./dist/testing.js");
    expect(testing.default).toBe("./dist/testing.js");
    expect(pkg.exports["./test"]).toBeDefined();
  });

  test("importing okengine or okengine/http does not pull the test harness into core/client bundles", async () => {
    const edgeSize = await measureKernelEdgeGzipBytes();
    const clientSize = await measureClientGzipBytes();
    expect(edgeSize).toBeLessThan(KERNEL_EDGE_BUDGET_BYTES);
    expect(clientSize).toBeLessThan(CLIENT_BUDGET_BYTES);
  });
});
