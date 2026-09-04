/**
 * Orphan reconciliation vs in-flight / DLQ messages.
 *
 * Config rows become orphaned when absent from declarations; durable messages
 * remain. Drain/replay require an active declaration — recovery is re-declare.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { memorySignalDriver } from "../../drivers/index.ts";
import { signal } from "./declare.ts";
import { createMemorySignalConfigStore, reconcileSignals } from "./reconcile.ts";
import { createSignalRuntime } from "./runtime.ts";

const openRuntimes: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  while (openRuntimes.length) {
    await openRuntimes.pop()!.close();
  }
});

describe("orphan signal messages", () => {
  test("orphaned config keeps durable DLQ; replay needs re-declare", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-signal-orphan-"));
    const durablePath = join(dir, "bus.json");
    try {
      const legacy = signal.once("legacy-shipped", { retries: 0,
        deadLetter: true });
      const runtime = createSignalRuntime({
        driver: memorySignalDriver,
        durablePath,
      });
      openRuntimes.push(runtime);
      runtime.register(legacy);
      const bus = await runtime.start();

      await bus.subscribe("legacy-shipped", "c1", async () => {
        throw new Error("gone");
      });
      await bus.emit("legacy-shipped", { shipmentId: "shp_9" });
      await bus.drain();
      expect(await bus.deadLetters("legacy-shipped")).toHaveLength(1);
      await runtime.close();
      openRuntimes.pop();

      // Config reconciliation: signal removed from code → orphaned, not deleted.
      const store = createMemorySignalConfigStore();
      await reconcileSignals([legacy], store);
      const after = await reconcileSignals([], store);
      expect(after.orphaned).toEqual(["legacy-shipped"]);
      expect(after.rows.find((r) => r.name === "legacy-shipped")?.status).toBe("orphaned");

      // Bus without the declaration: messages still load, but ops require decl.
      const emptyRuntime = createSignalRuntime({
        driver: memorySignalDriver,
        durablePath,
      });
      openRuntimes.push(emptyRuntime);
      const emptyBus = await emptyRuntime.start();
      await expect(
        emptyBus.replay({
          signal: "legacy-shipped",
          ratePerSec: 10,
          dryRun: false,
        }),
      ).rejects.toThrow(/Unknown signal/);
      await emptyRuntime.close();
      openRuntimes.pop();

      // Re-declare → DLQ processable again via replay.
      const restored = signal.once("legacy-shipped", { retries: 0,
        deadLetter: true });
      const again = await reconcileSignals([restored], store);
      expect(again.active).toEqual(["legacy-shipped"]);
      expect(again.orphaned).toEqual([]);

      const restoreRuntime = createSignalRuntime({
        driver: memorySignalDriver,
        durablePath,
      });
      openRuntimes.push(restoreRuntime);
      restoreRuntime.register(restored);
      const restoreBus = await restoreRuntime.start();
      const seen: unknown[] = [];
      await restoreBus.subscribe("legacy-shipped", "c2", async (m) => {
        seen.push(m.payload);
      });
      const result = await restoreBus.replay({
        signal: "legacy-shipped",
        ratePerSec: 100,
        dryRun: false,
      });
      expect(result.succeeded).toBe(1);
      expect(seen).toEqual([{ shipmentId: "shp_9" }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("pending messages for an undeclared signal are not drained", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-signal-orphan-pend-"));
    const durablePath = join(dir, "bus.json");
    try {
      const once = signal.once("legacy-shipped", { optional: true });
      const runtime = createSignalRuntime({
        driver: memorySignalDriver,
        durablePath,
      });
      openRuntimes.push(runtime);
      runtime.register(once);
      const bus = await runtime.start();
      await bus.emit("legacy-shipped", { id: 1 });
      await runtime.close();
      openRuntimes.pop();

      const other = signal.once("order-placed");
      const next = createSignalRuntime({
        driver: memorySignalDriver,
        durablePath,
      });
      openRuntimes.push(next);
      next.register(other);
      const nextBus = await next.start();
      const seen: unknown[] = [];
      await nextBus.subscribe("order-placed", "c1", async (m) => {
        seen.push(m.payload);
      });
      // Even a subscriber on a different name cannot claim orphaned-name rows,
      // and legacy-shipped has no declaration so it cannot be subscribed.
      await nextBus.drain();
      expect(seen).toEqual([]);
      await expect(nextBus.subscribe("legacy-shipped", "x", async () => {})).rejects.toThrow(
        /Unknown signal/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
