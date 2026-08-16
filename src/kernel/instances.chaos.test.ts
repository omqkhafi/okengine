/**
 * Fleet registry chaos — N alive, SIGKILL TTL drop, graceful release,
 * test-env-off honesty, Clock+Journal identity join.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { clock } from "../elements/clock.ts";
import { tryAcquireLease } from "../elements/clock/leader.ts";
import { bootApplication } from "./boot.ts";
import { flow } from "./flow.ts";
import { hasJournalLease } from "./journal.ts";
import {
  createFileInstanceStore,
  createMemoryInstanceStore,
  projectInstancesList,
} from "./instances.ts";

const childPath = join(import.meta.dir, "instances-chaos-child.ts");

async function waitForFile(path: string, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await Bun.file(path).exists()) return true;
    await Bun.sleep(10);
  }
  return false;
}

async function aliveIds(storePath: string): Promise<string[]> {
  const store = createFileInstanceStore(storePath);
  const list = await projectInstancesList({ store });
  if (list.kind === "empty") return [];
  return list.instances.map((row) => row.id).sort();
}

function spawnHeartbeat(
  storePath: string,
  instanceId: string,
  readyPath: string,
  heartbeatMs: number,
  leaseMs: number,
  cmd: "heartbeat-loop" | "graceful-hold" = "heartbeat-loop",
): ReturnType<typeof Bun.spawn> {
  return Bun.spawn({
    cmd: [
      "bun",
      childPath,
      cmd,
      storePath,
      instanceId,
      readyPath,
      String(heartbeatMs),
      String(leaseMs),
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("chaos — fleet registry", () => {
  test("N alive: three OS processes share one registry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-fleet-n-"));
    const storePath = join(dir, "instances.json");
    const heartbeatMs = 40;
    const leaseMs = 200;
    const ids = ["inst-a", "inst-b", "inst-c"] as const;
    const children: ReturnType<typeof Bun.spawn>[] = [];
    try {
      for (const id of ids) {
        const ready = join(dir, `${id}.ready`);
        children.push(spawnHeartbeat(storePath, id, ready, heartbeatMs, leaseMs));
        expect(await waitForFile(ready)).toBe(true);
      }
      expect(await aliveIds(storePath)).toEqual([...ids]);
    } finally {
      for (const child of children) {
        child.kill(9);
        await child.exited;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("SIGKILL drop: count stays N until TTL, then N-1", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-fleet-kill-"));
    const storePath = join(dir, "instances.json");
    const heartbeatMs = 40;
    const leaseMs = 180;
    const tickSlackMs = 500;
    const children: ReturnType<typeof Bun.spawn>[] = [];
    try {
      for (const id of ["inst-a", "inst-b", "inst-c"] as const) {
        const ready = join(dir, `${id}.ready`);
        children.push(spawnHeartbeat(storePath, id, ready, heartbeatMs, leaseMs));
        expect(await waitForFile(ready)).toBe(true);
      }
      expect(await aliveIds(storePath)).toEqual(["inst-a", "inst-b", "inst-c"]);

      const doomed = children[0]!;
      const killAt = Date.now();
      doomed.kill(9);
      await doomed.exited;

      expect(await aliveIds(storePath)).toContain("inst-a");
      expect((await aliveIds(storePath)).length).toBe(3);

      const remainingAtKill = Math.max(0, leaseMs - 20);
      await Bun.sleep(Math.min(remainingAtKill / 2, 80));
      expect(await aliveIds(storePath)).toContain("inst-a");

      const deadline = killAt + leaseMs + tickSlackMs;
      while (Date.now() < deadline) {
        const ids = await aliveIds(storePath);
        if (!ids.includes("inst-a") && ids.length === 2) break;
        await Bun.sleep(15);
      }
      const after = await aliveIds(storePath);
      expect(after).not.toContain("inst-a");
      expect(after).toEqual(["inst-b", "inst-c"]);
      expect(Date.now() - killAt).toBeGreaterThanOrEqual(leaseMs - 40);
    } finally {
      for (const child of children.slice(1)) {
        child.kill(9);
        await child.exited;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("graceful release: row gone before TTL", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-fleet-term-"));
    const storePath = join(dir, "instances.json");
    const heartbeatMs = 40;
    const leaseMs = 5_000;
    const ready = join(dir, "inst-g.ready");
    const child = spawnHeartbeat(storePath, "inst-g", ready, heartbeatMs, leaseMs, "graceful-hold");
    try {
      expect(await waitForFile(ready)).toBe(true);
      expect(await aliveIds(storePath)).toEqual(["inst-g"]);

      child.kill("SIGTERM");
      expect(await child.exited).toBe(0);

      const goneAt = Date.now();
      const deadline = goneAt + 2_000;
      while (Date.now() < deadline) {
        if (!(await aliveIds(storePath)).includes("inst-g")) break;
        await Bun.sleep(10);
      }
      expect(await aliveIds(storePath)).not.toContain("inst-g");
      expect(Date.now() - goneAt).toBeLessThan(leaseMs / 2);
    } finally {
      child.kill(9);
      await child.exited;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("test-env-off: default boot does not write a fleet row", async () => {
    const result = await bootApplication({
      env: "test",
      startScheduler: false,
      clocks: [clock("hourly", { every: "1h" })],
      flows: [flow("plain", { do: () => ({ ok: true }) })],
    });
    try {
      expect(result.instances).toBeUndefined();
      expect(result.instanceId.startsWith("inst-")).toBe(true);
    } finally {
      await result.close();
    }
  });

  test("identity-join: Clock + Journal leases share the boot instanceId", async () => {
    const instanceStore = createMemoryInstanceStore();
    const result = await bootApplication({
      env: "test",
      instanceId: "join-a",
      instanceStore,
      startScheduler: false,
      clocks: [clock("hourly", { every: "1h" })],
      flows: [flow("charge", { durable: true, do: () => ({ ok: true }) })],
    });
    try {
      expect(result.instanceId).toBe("join-a");
      expect(result.clock?.instanceId).toBe("join-a");
      expect(result.journal?.instanceId).toBe("join-a");
      expect(result.instances?.instanceId).toBe("join-a");

      const t = result.clock!.now();
      expect(
        await tryAcquireLease({
          name: "hourly",
          instanceId: "join-a",
          now: t,
          leaseMs: 30_000,
          store: result.clock!.store,
        }),
      ).toBe(true);

      await result.journal!.store.put({
        id: "run-join",
        flow: "charge",
        status: "running",
        input: {},
        entries: [],
        createdAt: t,
        updatedAt: t,
      });
      const journalStore = result.journal?.store;
      expect(journalStore && hasJournalLease(journalStore)).toBe(true);
      if (!journalStore || !hasJournalLease(journalStore)) return;
      expect(await journalStore.acquireLease("run-join", "join-a", t, 30_000)).toBe(true);

      const list = await projectInstancesList({
        store: instanceStore,
        clock: result.clock!.store,
        journal: result.journal!.store,
        now: () => t + 1,
      });
      expect(list.kind).toBe("fleet");
      if (list.kind !== "fleet") return;
      expect(list.alive).toBe(1);
      expect(list.instances).toHaveLength(1);
      expect(list.instances[0]!.id).toBe("join-a");
      expect(list.instances[0]!.clock.map((c) => c.name)).toEqual(["hourly"]);
      expect(list.instances[0]!.journal).toEqual([
        { runId: "run-join", flow: "charge", leaseUntil: t + 30_000 },
      ]);
    } finally {
      await result.close();
    }
  });
});
