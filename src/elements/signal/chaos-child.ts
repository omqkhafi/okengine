/**
 * Chaos child — begins a transaction, stages write + emit, then exits
 * before commit (or is SIGKILL'd by the parent). Used by signal.test.ts.
 *
 * Args: <durablePath> <mode>
 *   mode = "mid-txn" → write + emit, then exit(99) without commit
 *   mode = "commit"  → write + emit + commit, then exit(0)
 */

import { join } from "node:path";
import { memorySignalDriver } from "../../drivers/signal-memory.ts";
import { signal } from "./declare.ts";
import { createSignalRuntime } from "./runtime.ts";

const durablePath = process.argv[2];
const mode = process.argv[3] ?? "mid-txn";

if (!durablePath) {
  console.error("usage: chaos-child <durablePath> <mid-txn|commit>");
  process.exit(2);
}

const orderPlaced = signal("order-placed", {
  delivery: "once",
  retries: 3,
  deadLetter: true,
});

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
