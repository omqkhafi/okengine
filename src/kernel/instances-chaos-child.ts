/**
 * Fleet chaos child — heartbeat / graceful release for multi-process tests.
 *
 *   heartbeat-loop <storePath> <instanceId> <readyPath> <heartbeatMs> <leaseMs>
 *   graceful-hold <storePath> <instanceId> <readyPath> <heartbeatMs> <leaseMs>
 */

import { createFileInstanceStore, createInstanceRuntime } from "./instances.ts";
import { installGracefulShutdown } from "./graceful-shutdown.ts";

const cmd = process.argv[2];

async function heartbeatLoop(
  storePath: string,
  instanceId: string,
  readyPath: string,
  heartbeatMs: number,
  leaseMs: number,
  graceful: boolean,
): Promise<void> {
  const store = createFileInstanceStore(storePath);
  const instances = createInstanceRuntime({
    instanceId,
    store,
    env: "test",
    heartbeatMs,
    leaseMs,
  });
  await instances.heartbeat();
  await Bun.write(readyPath, JSON.stringify({ instanceId, at: Date.now() }));

  if (graceful) {
    installGracefulShutdown({
      app: {
        bootResult: { instances },
        stop: async () => {
          await instances.close();
        },
      },
      exit: true,
    });
  }

  const period = Math.max(10, Math.floor(heartbeatMs / 2));
  setInterval(() => {
    void instances.maybeHeartbeat();
  }, period);
}

if (cmd === "heartbeat-loop" || cmd === "graceful-hold") {
  const storePath = process.argv[3];
  const instanceId = process.argv[4];
  const readyPath = process.argv[5];
  const heartbeatMs = Number(process.argv[6] ?? 50);
  const leaseMs = Number(process.argv[7] ?? 200);
  if (!storePath || !instanceId || !readyPath) {
    console.error(
      "usage: instances-chaos-child heartbeat-loop|graceful-hold <storePath> <instanceId> <readyPath> <heartbeatMs> <leaseMs>",
    );
    process.exit(2);
  }
  await heartbeatLoop(
    storePath,
    instanceId,
    readyPath,
    heartbeatMs,
    leaseMs,
    cmd === "graceful-hold",
  );
} else {
  console.error("usage: instances-chaos-child heartbeat-loop|graceful-hold …");
  process.exit(2);
}
