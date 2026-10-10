/**
 * Console fleet list — unbound is empty; injected store is a real join.
 */

import { describe, expect, test } from "bun:test";

import { createMemoryCronStore } from "../../elements/clock.ts";
import { createMemoryJournalStore } from "../../kernel/journal.ts";
import { createInstanceRuntime, createMemoryInstanceStore } from "../../kernel/instances.ts";
import { createConsoleState } from "./state.ts";

describe("listInstances", () => {
  test("unbound registry is empty, not alive 0", async () => {
    const prevDatabase = process.env.DATABASE_URL;
    const prevStoreSql = process.env.OKE_STORE_SQL_URL;
    delete process.env.DATABASE_URL;
    delete process.env.OKE_STORE_SQL_URL;
    try {
      const state = createConsoleState({ silentClaim: true });
      const list = await state.listInstances();
      expect(list).toEqual({ kind: "empty" });
    } finally {
      if (prevDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevDatabase;
      if (prevStoreSql === undefined) delete process.env.OKE_STORE_SQL_URL;
      else process.env.OKE_STORE_SQL_URL = prevStoreSql;
    }
  });

  test("injected store returns fleet + lease join", async () => {
    const instanceStore = createMemoryInstanceStore();
    const fleetCronStore = createMemoryCronStore();
    const journalStore = createMemoryJournalStore();
    const now = () => 1_000;
    const rt = createInstanceRuntime({
      instanceId: "inst-a",
      store: instanceStore,
      env: "dev",
      now,
    });
    await rt.heartbeat(1_000);
    await fleetCronStore.put({
      name: "hourly",
      status: "active",
      timezone: "UTC",
      overridable: false,
      leaderInstanceId: "inst-a",
      leaderLeaseUntil: 2_000,
    });
    await journalStore.put({
      id: "run-1",
      flow: "charge",
      status: "running",
      input: {},
      entries: [],
      createdAt: 1,
      updatedAt: 1,
      lockedBy: "inst-a",
      leaseExpiresAt: 2_000,
    });

    const state = createConsoleState({
      silentClaim: true,
      now,
      instanceStore,
      fleetCronStore,
      journalStore,
    });
    const list = await state.listInstances();
    expect(list.kind).toBe("fleet");
    if (list.kind !== "fleet") return;
    expect(list.alive).toBe(1);
    expect(list.instances[0]).toMatchObject({
      id: "inst-a",
      clock: [{ name: "hourly", leaseUntil: 2_000 }],
      journal: [{ runId: "run-1", flow: "charge", leaseUntil: 2_000 }],
    });
  });
});
