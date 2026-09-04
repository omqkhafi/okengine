/**
 * Chaos child — begins a transaction, stages write + emit, then exits
 * before commit (or is SIGKILL'd by the parent). Used by signal.test.ts.
 *
 * Args: <durablePath> <mode> [markerPath] [leaseMs]
 *   mode = "mid-txn"      → write + emit, then exit(99) without commit
 *   mode = "commit"       → write + emit + commit, then exit(0)
 *   mode = "consume-hang" → subscribe, drain one message, write marker, hang
 *                           (parent SIGKILL after claim; lease reclaim tested)
 */

import { join } from "node:path";
import { memorySignalDriver } from "../../drivers/signal-memory.ts";
import { signal } from "./declare.ts";
import { createSignalRuntime } from "./runtime.ts";

const durablePath = process.argv[2];
const mode = process.argv[3] ?? "mid-txn";
const markerPath = process.argv[4];
const leaseMs = process.argv[5] !== undefined ? Number(process.argv[5]) : undefined;

if (!durablePath) {
  console.error(
    "usage: chaos-child <durablePath> <mid-txn|commit|consume-hang> [markerPath] [leaseMs]",
  );
  process.exit(2);
}

const orderPlaced = signal.once("order-placed", { retries: 3,
  deadLetter: true,
  // Producer-only / cross-process consumer: no local subscriber at emit time.
  optional: true });

if (mode === "consume-hang") {
  if (!markerPath) {
    console.error("consume-hang requires markerPath");
    process.exit(2);
  }
  const runtime = createSignalRuntime({
    driver: memorySignalDriver,
    durablePath: join(durablePath),
    leaseMs: Number.isFinite(leaseMs) ? leaseMs : 50,
  });
  runtime.register(orderPlaced);
  const bus = await runtime.start();
  let claimed = false;
  await bus.subscribe("order-placed", "chaos-consumer", async () => {
    claimed = true;
    await Bun.write(markerPath, "claimed");
    // Hang while holding the claim — parent will SIGKILL before ack.
    await Bun.sleep(60_000);
  });
  await bus.drain();
  if (!claimed) {
    console.error("consume-hang: no message claimed");
    process.exit(3);
  }
  // Should be unreachable — parent kills us while sleeping in the handler.
  await Bun.sleep(60_000);
  process.exit(0);
}

const runtime = createSignalRuntime({
  driver: memorySignalDriver,
  durablePath: join(durablePath),
});
runtime.register(orderPlaced);
const bus = await runtime.start();
const tx = await bus.begin();
await tx.write("booking:1", { id: "1", status: "pending" });
await tx.emit("order-placed", { id: "1" });

if (mode === "commit") {
  await tx.commit();
  await runtime.close();
  process.exit(0);
}

// Mid-transaction: leave uncommitted and die. Parent may also SIGKILL us.
// Intentionally do not commit / close.
process.exit(99);
