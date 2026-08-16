/**
 * Fleet registry — projection honesty, heartbeat throttle, boot identity.
 */

import { describe, expect, test } from "bun:test";

import { clock } from "../elements/clock.ts";
import { bootApplication } from "./boot.ts";
import { flow } from "./flow.ts";
import { INSTANCE_ID_PREFIX } from "./instance-id.ts";
import {
  createInstanceRuntime,
  createMemoryInstanceStore,
  projectInstancesList,
} from "./instances.ts";

describe("projectInstancesList", () => {
  test("unbound store is empty, not alive 0", async () => {
    expect(await projectInstancesList({ store: null })).toEqual({ kind: "empty" });
    expect(await projectInstancesList({ store: undefined })).toEqual({ kind: "empty" });
  });

  test("expired rows are not alive", async () => {
    const store = createMemoryInstanceStore([
      {
        id: "dead",
        startedAt: 0,
        heartbeatAt: 0,
        leaseExpiresAt: 10,
        env: "dev",
      },
      {
        id: "live",
        startedAt: 0,
        heartbeatAt: 20,
        leaseExpiresAt: 50,
        env: "dev",
      },
    ]);
    const list = await projectInstancesList({ store, now: () => 25 });
    expect(list).toMatchObject({ kind: "fleet", alive: 1 });
    if (list.kind !== "fleet") return;
    expect(list.instances.map((r) => r.id)).toEqual(["live"]);
  });
});

describe("instance heartbeat", () => {
  test("maybeHeartbeat writes at most once per interval", async () => {
    const store = createMemoryInstanceStore();
    const rt = createInstanceRuntime({
      instanceId: "inst-h",
      store,
      env: "dev",
      heartbeatMs: 100,
      leaseMs: 300,
      now: () => 1_000,
    });
    await rt.maybeHeartbeat(1_000);
    await rt.maybeHeartbeat(1_050);
    const first = await store.get("inst-h");
    expect(first?.heartbeatAt).toBe(1_000);
    await rt.maybeHeartbeat(1_100);
    const second = await store.get("inst-h");
    expect(second?.heartbeatAt).toBe(1_100);
    expect(second?.startedAt).toBe(first?.startedAt);
  });
});

describe("boot instanceId unification", () => {
  test("Clock and Journal receive the same minted id", async () => {
    const result = await bootApplication({
      env: "test",
      startScheduler: false,
      clocks: [clock("hourly", { every: "1h" })],
      flows: [flow("charge", { durable: true, do: () => ({ ok: true }) })],
    });
    try {
      expect(result.instanceId.startsWith(INSTANCE_ID_PREFIX)).toBe(true);
      expect(result.clock?.instanceId).toBe(result.instanceId);
      expect(result.journal?.instanceId).toBe(result.instanceId);
    } finally {
      await result.close();
    }
  });
});
