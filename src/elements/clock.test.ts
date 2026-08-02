/**
 * Clock element acceptance (time-travel harness):
 * - durable flow killed mid-execution resumes at the failed step
 * - a 7-day sleep survives a restart
 * - three instances run a cron once (leader election)
 * - catch-up `"one"` after multi-slot downtime
 * - DST gap/overlap detect-only; overlap civil physics
 * - overridable edit accept / reject
 * - reconciliation marks a removed cron orphaned without deleting it
 *
 * Multi-process / SIGKILL proofs live in `clock/chaos.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { flow } from "../kernel/flow.ts";
import { createFileJournalStore, createMemoryJournalStore } from "../kernel/journal.ts";
import {
  clock,
  createClockRuntime,
  createMemoryCronStore,
  createTestClockRuntime,
  createTimeTravel,
  cronHealth,
  detectDstAmbiguity,
  editSchedule,
  nextOccurrences,
  parseDurationMs,
  reconcileClocks,
  runDurable,
  ScheduleNotOverridableError,
  tryAcquireLease,
} from "./clock.ts";

describe("clock declaration", () => {
  test("requires cron or every", () => {
    expect(() => clock("x", {})).toThrow(/cron or every/);
    const c = clock("nightly", {
      cron: "0 2 * * *",
      timezone: "America/New_York",
      overridable: true,
    });
    expect(c.name).toBe("nightly");
    expect(c.timezone).toBe("America/New_York");
    expect(c.overridable).toBe(true);
  });
});

describe("time-travel harness", () => {
  test("advance moves a frozen clock", () => {
    const t = createTimeTravel(1_000);
    expect(t.now()).toBe(1_000);
    t.advance("7d");
    expect(t.now()).toBe(1_000 + parseDurationMs("7d"));
    t.advance(60_000);
    expect(t.now()).toBe(1_000 + parseDurationMs("7d") + 60_000);
  });
});

describe("durable journal", () => {
  test("killed mid-execution resumes at the failed step, not the beginning", async () => {
    const calls: string[] = [];
    const journalStore = createMemoryJournalStore();
    const tt = createTimeTravel(0);
    let crashAfterFirstStep = true;

    const charge = flow({
      name: "payments.charge",
      durable: true,
      do: async (_input, fx) => {
        const intent = await fx.step("create-intent", () => {
          calls.push("create-intent");
          return { id: "pi_1" };
        });
        if (crashAfterFirstStep) {
          throw new Error("KILLED");
        }
        return fx.step("confirm", () => {
          calls.push("confirm");
          return intent.id === "pi_1";
        });
      },
    });

    const first = await runDurable({
      flow: charge,
      input: { orderId: "o1" },
      journalStore,
      now: tt.now,
    });
    expect(first.status).toBe("failed");
    expect(calls).toEqual(["create-intent"]);

    crashAfterFirstStep = false;
    const runId = first.status === "failed" ? first.runId : "";
    const second = await runDurable({
      flow: charge,
      input: { orderId: "o1" },
      journalStore,
      runId,
      now: tt.now,
    });

    expect(second.status).toBe("completed");
    if (second.status === "completed") {
      expect(second.output).toBe(true);
    }
    // create-intent never re-ran; confirm ran once.
    expect(calls).toEqual(["create-intent", "confirm"]);
  });

  test("7-day sleep survives a restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-clock-"));
    const journalPath = join(dir, "journal.json");
    const tt = createTimeTravel(0);

    try {
      const sleepy = flow({
        name: "trial.wait",
        durable: true,
        do: async (_input, fx) => {
          await fx.step("start", () => "begun");
          await fx.clock.sleep("trial-period", "7d");
          return fx.step("finish", () => "awake");
        },
      });

      // Process A: start, park on sleep, "crash" (drop runtime).
      const storeA = createFileJournalStore(journalPath);
      const parked = await runDurable({
        flow: sleepy,
        journalStore: storeA,
        now: tt.now,
      });
      expect(parked.status).toBe("sleeping");
      if (parked.status !== "sleeping") throw new Error("expected sleeping");
      expect(parked.wakeAt).toBe(parseDurationMs("7d"));
      const runId = parked.runId;

      // Process B: new store handle on same file, time still before wake.
      const storeB = createFileJournalStore(journalPath);
      const stillSleeping = await runDurable({
        flow: sleepy,
        journalStore: storeB,
        runId,
        now: tt.now,
      });
      expect(stillSleeping.status).toBe("sleeping");

      // Time travel past the wake, then resume.
      tt.advance("7d");
      const storeC = createFileJournalStore(journalPath);
      const done = await runDurable({
        flow: sleepy,
        journalStore: storeC,
        runId,
        now: tt.now,
      });
      expect(done.status).toBe("completed");
      if (done.status === "completed") {
        expect(done.output).toBe("awake");
      }

      const final = await storeC.get(runId);
      expect(final?.entries.filter((e) => e.kind === "step")).toHaveLength(2);
      expect(final?.entries.some((e) => e.kind === "sleep")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("leader election", () => {
  test("three instances run a cron once", async () => {
    const store = createMemoryCronStore();
    const tt = createTimeTravel(0);
    const fired: string[] = [];

    const decl = clock("expire-stale", { every: "1h" });
    const mk = (instanceId: string) => {
      const rt = createClockRuntime({
        instanceId,
        store,
        leaseMs: 60_000,
        timeTravel: tt,
      });
      rt.register(decl);
      rt.onCron("expire-stale", () => {
        fired.push(instanceId);
      });
      return rt;
    };

    const a = mk("i-a");
    const b = mk("i-b");
    const c = mk("i-c");
    await a.reconcile();

    const results = await Promise.all([
      a.runNow("expire-stale"),
      b.runNow("expire-stale"),
      c.runNow("expire-stale"),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(fired).toHaveLength(1);
    const winner = fired[0];
    if (winner === undefined) throw new Error("expected a winner");
    expect(["i-a", "i-b", "i-c"]).toContain(winner);

    // Lease still held — further runs are denied until expiry.
    expect(await a.runNow("expire-stale")).toBe(false);
    expect(fired).toHaveLength(1);

    // After lease expires, another instance may run.
    tt.advance(60_001);
    expect(await b.runNow("expire-stale")).toBe(true);
    expect(fired).toEqual([winner, "i-b"]);
  });

  test("tryAcquireLease is exclusive within the lease window", async () => {
    const store = createMemoryCronStore([
      {
        name: "job",
        effectiveEvery: "1h",
        timezone: "UTC",
        overridable: false,
        status: "active",
      },
    ]);
    expect(
      await tryAcquireLease({
        name: "job",
        instanceId: "a",
        now: 0,
        leaseMs: 1000,
        store,
      }),
    ).toBe(true);
    expect(
      await tryAcquireLease({
        name: "job",
        instanceId: "b",
        now: 500,
        leaseMs: 1000,
        store,
      }),
    ).toBe(false);
    expect(
      await tryAcquireLease({
        name: "job",
        instanceId: "b",
        now: 1001,
        leaseMs: 1000,
        store,
      }),
    ).toBe(true);
  });
});

describe("reconciliation", () => {
  test("marks a removed cron orphaned without deleting it", async () => {
    const store = createMemoryCronStore();
    const a = clock("keep", { every: "10m" });
    const b = clock("remove-me", { cron: "0 * * * *", overridable: true });

    const first = await reconcileClocks([a, b], store);
    expect([...first.active].sort()).toEqual(["keep", "remove-me"]);
    expect(await store.get("remove-me")).toMatchObject({ status: "active" });

    // Override is preserved across reconcile while still declared.
    await store.put({
      ...(await store.get("remove-me"))!,
      overrideCron: "30 * * * *",
      effectiveCron: "30 * * * *",
    });
    await reconcileClocks([a, b], store);
    expect((await store.get("remove-me"))?.overrideCron).toBe("30 * * * *");
    expect((await store.get("remove-me"))?.effectiveCron).toBe("30 * * * *");

    // Code no longer declares remove-me → orphaned, not deleted.
    const second = await reconcileClocks([a], store);
    expect(second.orphaned).toContain("remove-me");
    const orphan = await store.get("remove-me");
    expect(orphan).toBeDefined();
    expect(orphan?.status).toBe("orphaned");
    expect(orphan?.overrideCron).toBe("30 * * * *");

    // Scheduler runtime skips orphaned rows.
    const rt = createTestClockRuntime(0, { store, instanceId: "solo" });
    rt.register(a);
    await rt.reconcile();
    let ranOrphan = false;
    rt.onCron("remove-me", () => {
      ranOrphan = true;
    });
    rt.onCron("keep", () => {});
    await rt.runNow("remove-me");
    expect(ranOrphan).toBe(false);
  });

  test("scheduler reads effective state from the store", async () => {
    const store = createMemoryCronStore();
    const rt = createTestClockRuntime(0, { store, instanceId: "s1" });
    rt.register(clock("job", { every: "1h", overridable: true }));
    await rt.reconcile();

    await store.put({
      ...(await store.get("job"))!,
      overrideEvery: "5m",
      effectiveEvery: "5m",
    });

    const fired: number[] = [];
    rt.onCron("job", () => {
      fired.push(rt.now());
    });

    await rt.tick();
    expect(fired).toHaveLength(1);

    // Not due again until effective every (5m) elapses — not the declared 1h.
    await rt.tick();
    expect(fired).toHaveLength(1);
    rt.advance("5m");
    await rt.tick();
    expect(fired).toHaveLength(2);
  });
});

describe("catch-up policy one", () => {
  test("5h downtime on hourly clock: one fire, missedRuns reflects the gap", async () => {
    const store = createMemoryCronStore();
    const rt = createTestClockRuntime(0, {
      store,
      instanceId: "catchup",
      leaseMs: 60_000,
    });
    rt.register(clock("hourly", { every: "1h" }));
    await rt.reconcile();
    await store.put({
      ...(await store.get("hourly"))!,
      lastRunAt: 0,
    });

    rt.advance("5h");
    const before = cronHealth((await store.get("hourly"))!, rt.now());
    expect(before.overdue).toBe(true);
    expect(before.missedRuns).toBe(5);
    expect(before.catchUp).toBe("one");

    const fired: number[] = [];
    rt.onCron("hourly", () => {
      fired.push(rt.now());
    });
    const { ran } = await rt.tick();
    expect(ran).toEqual(["hourly"]);
    expect(fired).toHaveLength(1);

    // Not five catch-up runs — and not silently zero.
    await rt.tick();
    expect(fired).toHaveLength(1);
  });
});

describe("DST ambiguity", () => {
  test("detected from expression plus zone", () => {
    // 02:00 America/New_York sits in the spring-forward gap / fall-back overlap.
    const amb = detectDstAmbiguity("0 2 * * *", "America/New_York", Date.UTC(2026, 0, 1));
    expect(amb).not.toBeNull();
    if (!amb) throw new Error("expected DST ambiguity");
    expect(amb.localTime).toBe("02:00");
    expect(amb.timezone).toBe("America/New_York");
    expect(["gap", "overlap"]).toContain(amb.kind);

    // UTC has no DST — never warn.
    expect(detectDstAmbiguity("0 2 * * *", "UTC")).toBeNull();

    // Noon is outside the transition window for US zones.
    expect(detectDstAmbiguity("0 12 * * *", "America/New_York", Date.UTC(2026, 0, 1))).toBeNull();
  });

  test("gap vs overlap kinds are distinct for US transitions", () => {
    // 2026-03-08 spring forward → 02:00 skipped (gap).
    const gap = detectDstAmbiguity("0 2 * * *", "America/New_York", Date.UTC(2026, 2, 1));
    expect(gap?.kind).toBe("gap");

    // 2026-11-01 fall back → 01:30 occurs twice (overlap).
    const overlap = detectDstAmbiguity("30 1 * * *", "America/New_York", Date.UTC(2026, 10, 1));
    expect(overlap?.kind).toBe("overlap");
  });

  test("reconcile attaches dstAmbiguity on the store row (passive warning)", async () => {
    const store = createMemoryCronStore();
    const rt = createTestClockRuntime(Date.UTC(2026, 0, 1), {
      store,
      instanceId: "dst",
    });
    rt.register(
      clock("nightly", {
        cron: "0 2 * * *",
        timezone: "America/New_York",
      }),
    );
    // Detection never throws — warn-only, no schedule rewrite.
    await rt.reconcile();
    const row = await store.get("nightly");
    expect(row?.dstAmbiguity).toBeDefined();
    expect(row?.dstAmbiguity?.localTime).toBe("02:00");
    expect(row?.status).toBe("active");
    expect(row?.effectiveCron).toBe("0 2 * * *");
  });

  test("doctor does not enforce or surface DST (detection is Console-only)", async () => {
    const doctorSrc = await Bun.file(new URL("../cli/doctor.ts", import.meta.url)).text();
    expect(doctorSrc.toLowerCase()).not.toContain("dst");
    expect(doctorSrc).not.toMatch(/detectDstAmbiguity/);
  });

  test("overlap day: two civil instants; lease does not span the gap; stub isDue avoids walk", async () => {
    // US fall-back 2026-11-01: 01:30 local occurs twice (~1h apart in UTC).
    const from = Date.UTC(2026, 10, 1, 0, 0, 0);
    const until = Date.UTC(2026, 10, 2, 0, 0, 0);
    const fires = nextOccurrences(
      {
        name: "ambig",
        effectiveCron: "30 1 * * *",
        timezone: "America/New_York",
        overridable: false,
        status: "active",
      },
      from,
      until,
    );
    expect(fires.length).toBe(2);
    expect(fires[1]! - fires[0]!).toBe(3_600_000);

    // Stub isDue (nextRunAt unset after first fire): does not walk civil fires →
    // advancing across the overlap gap does not double-fire.
    const store = createMemoryCronStore();
    const rt = createTestClockRuntime(0, {
      store,
      instanceId: "dst-fire",
      leaseMs: 1_000,
    });
    rt.register(
      clock("ambig", {
        cron: "30 1 * * *",
        timezone: "America/New_York",
      }),
    );
    await rt.reconcile();
    const ran: number[] = [];
    rt.onCron("ambig", () => {
      ran.push(rt.now());
    });
    expect((await rt.tick()).ran).toEqual(["ambig"]);
    rt.advance(3_600_000);
    expect((await rt.tick()).ran).toEqual([]);
    expect(ran).toHaveLength(1);

    // Lease TTL << 1h overlap gap: if nextRunAt is driven to the second civil
    // instant, a second fire CAN occur. Leader lease is not a DST policy.
    const store2 = createMemoryCronStore();
    const rt2 = createTestClockRuntime(fires[0]! - 1, {
      store: store2,
      instanceId: "dst-risk",
      leaseMs: 1_000,
    });
    rt2.register(
      clock("ambig2", {
        cron: "30 1 * * *",
        timezone: "America/New_York",
      }),
    );
    await rt2.reconcile();
    await store2.put({
      ...(await store2.get("ambig2"))!,
      nextRunAt: fires[0],
    });
    const ran2: number[] = [];
    rt2.onCron("ambig2", () => {
      ran2.push(rt2.now());
    });
    rt2.advance(2);
    expect((await rt2.tick()).ran).toEqual(["ambig2"]);
    rt2.advance(fires[1]! - rt2.now());
    await store2.put({
      ...(await store2.get("ambig2"))!,
      nextRunAt: fires[1],
    });
    expect((await rt2.tick()).ran).toEqual(["ambig2"]);
    expect(ran2).toHaveLength(2);
  });
});

describe("overridable Console edit", () => {
  test("editSchedule accepts overridable and rejects locked clocks", async () => {
    const store = createMemoryCronStore();
    await reconcileClocks(
      [
        clock("tunable", { every: "1h", overridable: true }),
        clock("locked", { cron: "0 2 * * *", overridable: false }),
      ],
      store,
    );

    const edited = await editSchedule(store, { name: "tunable", every: "5m" });
    expect(edited.effectiveEvery).toBe("5m");
    expect(edited.overrideEvery).toBe("5m");

    await expect(editSchedule(store, { name: "locked", cron: "0 3 * * *" })).rejects.toBeInstanceOf(
      ScheduleNotOverridableError,
    );
    await expect(editSchedule(store, { name: "locked", cron: "0 3 * * *" })).rejects.toThrow(
      /not overridable/,
    );
  });
});
