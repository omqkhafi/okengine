/**
 * Graceful shutdown — Clock / Journal lease release without waiting for TTL.
 */

import { describe, expect, test } from "bun:test";

import { createClockRuntime, createMemoryCronStore } from "../elements/clock.ts";
import { tryAcquireLease } from "../elements/clock/leader.ts";
import { createMemoryJournalStore, hasJournalLease, JOURNAL_DEFAULT_LEASE_MS } from "./journal.ts";
import { releaseInstanceLeases } from "./graceful-shutdown.ts";

describe("releaseInstanceLeases", () => {
  test("releases Clock cron leases held by this instance", async () => {
    const store = createMemoryCronStore();
    await store.put({
      name: "hourly",
      status: "active",
      timezone: "UTC",
      overridable: false,
      effectiveEvery: "1h",
    });
    const clock = createClockRuntime({ store, instanceId: "inst-a", leaseMs: 30_000 });
    const t = 1_000_000;
    expect(
      await tryAcquireLease({
        name: "hourly",
        instanceId: "inst-a",
        now: t,
        leaseMs: 30_000,
        store,
      }),
    ).toBe(true);
    expect((await store.get("hourly"))!.leaderInstanceId).toBe("inst-a");

    await releaseInstanceLeases({
      bootResult: {
        clock: {
          instanceId: clock.instanceId,
          store,
          now: () => t + 1,
        },
      },
      stop: async () => {},
    });

    const row = await store.get("hourly");
    expect(row!.leaderInstanceId).toBeUndefined();
    expect(row!.leaderLeaseUntil).toBeUndefined();
  });

  test("releases Journal run leases held by this instance", async () => {
    const store = createMemoryJournalStore();
    expect(hasJournalLease(store)).toBe(true);
    const runId = "run-1";
    await store.put({
      id: runId,
      flow: "charge",
      status: "running",
      input: {},
      entries: [],
      createdAt: 1,
      updatedAt: 1,
    });
    expect(await store.acquireLease!(runId, "inst-a", 1_000, JOURNAL_DEFAULT_LEASE_MS)).toBe(true);
    expect((await store.get(runId))!.lockedBy).toBe("inst-a");

    await releaseInstanceLeases({
      bootResult: {
        journal: { instanceId: "inst-a", store },
      },
      stop: async () => {},
    });

    expect((await store.get(runId))!.lockedBy).toBeUndefined();
  });
});
