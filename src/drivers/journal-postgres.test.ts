/**
 * Postgres JournalStore — unit (fake). Live multi-process boot chaos lives in
 * `src/elements/clock/journal-boot.test.ts` (same LIVE_URL gate as clock).
 */

import { describe, expect, test } from "bun:test";

import type { JournalRun } from "../kernel/journal.ts";
import { createPostgresJournalFake, createPostgresJournalStore } from "./journal-postgres.ts";

function seedRun(patch: Partial<JournalRun> & { id: string }): JournalRun {
  return {
    flow: "charge",
    input: undefined,
    status: "running",
    entries: [],
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

describe("postgres JournalStore (fake)", () => {
  test("put / get / list round-trip incl. lease + sleep fields", async () => {
    const store = await createPostgresJournalStore({ sql: createPostgresJournalFake() });
    await store.put(
      seedRun({
        id: "r1",
        input: { orderId: "o1" },
        entries: [
          { kind: "step", name: "create-intent", value: { id: "pi_1" }, at: 2 },
          { kind: "sleep", label: "verify", duration: "7d", wakeAt: 1000, at: 3 },
        ],
        status: "sleeping",
        wakeAt: 1000,
        lockedBy: "inst-a",
        leaseExpiresAt: 500,
        output: { ok: true },
      }),
    );
    const row = await store.get("r1");
    expect(row?.flow).toBe("charge");
    expect(row?.input).toEqual({ orderId: "o1" });
    expect(row?.entries).toHaveLength(2);
    expect(row?.status).toBe("sleeping");
    expect(row?.wakeAt).toBe(1000);
    expect(row?.lockedBy).toBe("inst-a");
    expect(row?.leaseExpiresAt).toBe(500);
    expect(row?.output).toEqual({ ok: true });
    expect(await store.list()).toHaveLength(1);
    await store.close();
  });

  test("acquireLease: exactly one of two racing claimants wins", async () => {
    const store = await createPostgresJournalStore({ sql: createPostgresJournalFake() });
    await store.put(seedRun({ id: "race" }));

    const a = store.acquireLease("race", "a", 1_000, 500);
    const b = store.acquireLease("race", "b", 1_000, 500);
    const [wa, wb] = await Promise.all([a, b]);
    expect([wa, wb].filter(Boolean)).toHaveLength(1);

    const row = await store.get("race");
    expect(row?.lockedBy).toBe(wa ? "a" : "b");
    expect(row?.leaseExpiresAt).toBe(1_500);
    await store.close();
  });

  test("acquireLease: expired lease is reclaimed lazily (no sweeper)", async () => {
    const store = await createPostgresJournalStore({ sql: createPostgresJournalFake() });
    await store.put(seedRun({ id: "reclaim", lockedBy: "dead", leaseExpiresAt: 100 }));

    expect(await store.acquireLease("reclaim", "survivor", 100, 50)).toBe(true);
    const row = await store.get("reclaim");
    expect(row?.lockedBy).toBe("survivor");
    expect(row?.leaseExpiresAt).toBe(150);
    await store.close();
  });

  test("acquireLease: live lease blocks other instance; same holder renews", async () => {
    const store = await createPostgresJournalStore({ sql: createPostgresJournalFake() });
    await store.put(seedRun({ id: "held" }));
    expect(await store.acquireLease("held", "leader", 0, 1_000)).toBe(true);
    expect(await store.acquireLease("held", "other", 100, 1_000)).toBe(false);
    expect(await store.acquireLease("held", "leader", 100, 1_000)).toBe(true);
    await store.close();
  });

  test("claimDueSleep: claims due sleep, skips future + live-leased", async () => {
    const store = await createPostgresJournalStore({ sql: createPostgresJournalFake() });
    await store.put(seedRun({ id: "future", status: "sleeping", wakeAt: 10_000 }));
    await store.put(
      seedRun({
        id: "leased",
        status: "sleeping",
        wakeAt: 100,
        lockedBy: "other",
        leaseExpiresAt: 9_000,
      }),
    );
    await store.put(seedRun({ id: "due", status: "sleeping", wakeAt: 100 }));
    await store.put(seedRun({ id: "done", status: "completed" }));

    const claimed = await store.claimDueSleep("me", 1_000, 500);
    expect(claimed?.id).toBe("due");
    const row = await store.get("due");
    expect(row?.lockedBy).toBe("me");
    expect(row?.leaseExpiresAt).toBe(1_500);

    // Nothing else claimable.
    expect(await store.claimDueSleep("me", 1_000, 500)).toBeUndefined();
    await store.close();
  });

  test("claimDueSleep: two racing claims hand the run to exactly one instance", async () => {
    const store = await createPostgresJournalStore({ sql: createPostgresJournalFake() });
    await store.put(seedRun({ id: "due", status: "sleeping", wakeAt: 100 }));

    const [a, b] = await Promise.all([
      store.claimDueSleep("a", 1_000, 500),
      store.claimDueSleep("b", 1_000, 500),
    ]);
    const winners = [a, b].filter((r) => r?.id === "due");
    expect(winners).toHaveLength(1);
    await store.close();
  });

  test("claimDueSleep: expired lease on a sleeping run is reclaimable", async () => {
    const store = await createPostgresJournalStore({ sql: createPostgresJournalFake() });
    await store.put(
      seedRun({
        id: "stale",
        status: "sleeping",
        wakeAt: 100,
        lockedBy: "dead",
        leaseExpiresAt: 50,
      }),
    );
    const claimed = await store.claimDueSleep("survivor", 1_000, 500);
    expect(claimed?.id).toBe("stale");
    expect((await store.get("stale"))?.lockedBy).toBe("survivor");
    await store.close();
  });

  test("listOrphans: running/sleeping/compensating without a live lease; never completed", async () => {
    const store = await createPostgresJournalStore({ sql: createPostgresJournalFake() });
    await store.put(seedRun({ id: "running-unlocked" }));
    await store.put(seedRun({ id: "running-expired", lockedBy: "dead", leaseExpiresAt: 10 }));
    await store.put(seedRun({ id: "running-live", lockedBy: "alive", leaseExpiresAt: 9_000 }));
    await store.put(seedRun({ id: "sleeping-future", status: "sleeping", wakeAt: 99_000 }));
    await store.put(seedRun({ id: "compensating-open", status: "compensating" }));
    await store.put(seedRun({ id: "done", status: "completed" }));

    const orphans = (await store.listOrphans(1_000)).map((r) => r.id);
    expect(orphans).toContain("running-unlocked");
    expect(orphans).toContain("running-expired");
    expect(orphans).toContain("sleeping-future");
    expect(orphans).toContain("compensating-open");
    expect(orphans).not.toContain("running-live");
    expect(orphans).not.toContain("done");
    await store.close();
  });

  test("releaseLease: holder releases; other holder cannot", async () => {
    const store = await createPostgresJournalStore({ sql: createPostgresJournalFake() });
    await store.put(seedRun({ id: "r", lockedBy: "a", leaseExpiresAt: 500 }));

    await store.releaseLease("r", "b");
    expect((await store.get("r"))?.lockedBy).toBe("a");

    await store.releaseLease("r", "a");
    const row = await store.get("r");
    expect(row?.lockedBy).toBeUndefined();
    expect(row?.leaseExpiresAt).toBeUndefined();
    await store.close();
  });
});
