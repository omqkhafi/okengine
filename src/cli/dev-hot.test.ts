/**
 * Soft-reload slot: one live generation, disposed before the next boot.
 */

import { describe, expect, test } from "bun:test";
import { installDevHotGeneration, takeDevHotGeneration } from "./dev-hot.ts";

describe("dev hot generation", () => {
  test("take returns the installed generation once", async () => {
    let disposed = 0;
    installDevHotGeneration({
      async dispose() {
        disposed += 1;
      },
    });
    const first = takeDevHotGeneration();
    expect(first).toBeDefined();
    await first!.dispose();
    expect(disposed).toBe(1);
    expect(takeDevHotGeneration()).toBeUndefined();
  });

  test("install replaces the previous slot without disposing it", () => {
    installDevHotGeneration({
      async dispose() {
        throw new Error("stale");
      },
    });
    let disposed = 0;
    installDevHotGeneration({
      async dispose() {
        disposed += 1;
      },
    });
    const current = takeDevHotGeneration();
    expect(current).toBeDefined();
    return current!.dispose().then(() => {
      expect(disposed).toBe(1);
    });
  });
});
