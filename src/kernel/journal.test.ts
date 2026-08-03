/**
 * Journal lease lifecycle — same SKIP LOCKED + lazy-reclaim law as Signal /
 * Clock, here against the memory store (fake-free, single process).
 */

import { describe, expect, test } from "bun:test";

import {
  createJournal,
  createMemoryJournalStore,
  hasJournalLease,
  isJournalLeaseBusy,
  isJournalSuspend,
  JOURNAL_DEFAULT_LEASE_MS,
} from "./journal.ts";

describe("journal lease (memory store)", () => {
  test("built-in stores expose the lease surface", () => {
    expect(hasJournalLease(createMemoryJournalStore())).toBe(true);
  });

  test("start inserts already holding the lease; persist renews it", async () => {
    let t = 1_000;
    const store = createMemoryJournalStore();
    const journal = createJournal({
      store,
      now: () => t,
      lease: { instanceId: "a", leaseMs: 500 },
    });
    const session = await journal.start("charge", { orderId: "o1" });

    let row = await store.get(session.runId);
    expect(row?.lockedBy).toBe("a");
    expect(row?.leaseExpiresAt).toBe(1_500);

    t = 1_400;
    await session.step("create-intent", () => ({ id: "pi_1" }));
    row = await store.get(session.runId);
    expect(row?.leaseExpiresAt).toBe(1_900);
  });

  test("a live lease blocks a second claimant until expiry", async () => {
    let t = 1_000;
    const store = createMemoryJournalStore();
    const a = createJournal({ store, now: () => t, lease: { instanceId: "a", leaseMs: 200 } });
    const session = await a.start("charge");

    const b = createJournal({ store, now: () => t, lease: { instanceId: "b", leaseMs: 200 } });
    try {
      await b.resume(session.runId);
      expect.unreachable("resume under a live lease must throw");
    } catch (err) {
      expect(isJournalLeaseBusy(err)).toBe(true);
    }

    // After expiry the survivor reclaims lazily.
    t = 1_300;
    const resumed = await b.resume(session.runId);
    expect(resumed.runId).toBe(session.runId);
    expect((await store.get(session.runId))?.lockedBy).toBe("b");
  });

  test("parking a sleep releases the lease; run stays claimable when due", async () => {
    let t = 1_000;
    const store = createMemoryJournalStore();
    const journal = createJournal({
      store,
      now: () => t,
      lease: { instanceId: "a", leaseMs: 30_000 },
    });
    const session = await journal.start("charge");
    try {
      await session.sleep("verify-window", "2m", () => 120_000);
      expect.unreachable("sleep must suspend");
    } catch (err) {
      expect(isJournalSuspend(err)).toBe(true);
    }

    const parked = await store.get(session.runId);
    expect(parked?.status).toBe("sleeping");
    expect(parked?.lockedBy).toBeUndefined();
    expect(parked?.leaseExpiresAt).toBeUndefined();

    // Due → another instance claims + resumes without a lease race.
    t += 121_000;
    const claimed = await store.claimDueSleep!("b", t, JOURNAL_DEFAULT_LEASE_MS);
    expect(claimed?.id).toBe(session.runId);
  });

  test("terminal commit releases the lease", async () => {
    const store = createMemoryJournalStore();
    const journal = createJournal({
      store,
      now: () => 1_000,
      lease: { instanceId: "a", leaseMs: 30_000 },
    });
    const session = await journal.start("charge");
    await session.commit("completed", { output: 42 });

    const row = await store.get(session.runId);
    expect(row?.status).toBe("completed");
    expect(row?.lockedBy).toBeUndefined();
    expect(row?.leaseExpiresAt).toBeUndefined();
  });

  test("crash mid-run: orphan discovery sees the expired lease; replay skips completed steps", async () => {
    let t = 1_000;
    const store = createMemoryJournalStore();
    const calls: string[] = [];
    const a = createJournal({ store, now: () => t, lease: { instanceId: "a", leaseMs: 100 } });
    const session = await a.start("charge");
    await session.step("create-intent", () => {
      calls.push("create-intent");
      return { id: "pi_1" };
    });
    // "Crash": no commit, lease left to expire.

    t = 1_200;
    const orphans = await store.listOrphans!(t);
    expect(orphans.map((r) => r.id)).toEqual([session.runId]);

    const b = createJournal({ store, now: () => t, lease: { instanceId: "b", leaseMs: 100 } });
    const resumed = await b.resume(session.runId);
    const value = await resumed.step("create-intent", () => {
      calls.push("re-run");
      return { id: "pi_2" };
    });
    expect(value).toEqual({ id: "pi_1" });
    expect(calls).toEqual(["create-intent"]);
  });

  test("no lease option → legacy uncoordinated sessions still work", async () => {
    const store = createMemoryJournalStore();
    const journal = createJournal({ store, now: () => 1_000 });
    const session = await journal.start("charge");
    await session.step("s", () => 1);
    expect((await store.get(session.runId))?.lockedBy).toBeUndefined();
    // Resume without lease never throws busy.
    const again = await journal.resume(session.runId);
    expect(await again.step("s", () => 2)).toBe(1);
  });
});
