/**
 * Console Clock projection — timeline, waiting-on, health, actions.
 */

import { describe, expect, test } from "bun:test";
import { createMemoryJournalStore } from "../../kernel/journal.ts";
import type { Manifest } from "../../manifest/types.ts";
import {
  createManifestClockRuntime,
  editCronSchedule,
  pauseCronNow,
  projectClocksList,
  projectWaitingOn,
  ScheduleNotOverridableError,
  wakeEarlyNow,
} from "./clock.ts";

const manifest: Manifest = {
  oke: "1.0",
  app: "clock-test",
  clocks: {
    "expire-holds": {
      every: "10m",
      overridable: true,
    },
    nightly: {
      cron: "0 2 * * *",
      timezone: "America/New_York",
      overridable: false,
    },
  },
  flows: {
    "holds.expire": {
      trigger: { every: "10m" },
      effects: { writes: ["sql:db.holds"] },
    },
    "reports.nightly": {
      trigger: { cron: "0 2 * * *" },
      effects: { sends: ["email:report"] },
    },
  },
};

describe("projectClocksList", () => {
  test("projects health, external, waiting-on, and timeline", async () => {
    const now = 1_000_000;
    const runtime = createManifestClockRuntime(manifest, {
      now: () => now,
    });
    await runtime.reconcile();
    await runtime.store.put({
      ...(await runtime.store.get("expire-holds"))!,
      lastRunAt: now - 30 * 60_000,
      nextRunAt: now - 20 * 60_000,
      leaderInstanceId: "inst-a",
      leaderLeaseUntil: now + 30_000,
    });

    const journal = createMemoryJournalStore([
      {
        id: "run_1",
        flow: "payments.verify",
        input: {},
        status: "sleeping",
        entries: [
          { kind: "step", name: "create-intent", value: {}, at: now - 1000 },
          {
            kind: "sleep",
            label: "verify-window",
            duration: "2m",
            wakeAt: now + 60_000,
            at: now - 500,
          },
        ],
        wakeAt: now + 60_000,
        createdAt: now - 2000,
        updatedAt: now - 500,
      },
      {
        id: "run_2",
        flow: "trials.start",
        input: {},
        status: "sleeping",
        entries: [
          {
            kind: "sleep",
            label: "trial-period",
            duration: "7d",
            wakeAt: now + 3_600_000,
            at: now,
          },
        ],
        wakeAt: now + 3_600_000,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const list = await projectClocksList({
      manifest,
      runtime,
      journal,
      now: () => now,
    });

    expect(list.crons.length).toBeGreaterThanOrEqual(2);
    const expire = list.crons.find((c) => c.name === "expire-holds");
    expect(expire?.health.overdue).toBe(true);
    expect(expire?.health.catchUp).toBe("one");
    expect(expire?.health.leaderInstanceId).toBe("inst-a");
    expect(expire?.overridable).toBe(true);

    const nightly = list.crons.find((c) => c.name === "nightly");
    expect(nightly?.external).toBe(true);
    expect(nightly?.flowIds).toContain("reports.nightly");

    expect(list.waitingOn.length).toBe(2);
    expect(list.waitingOn[0]?.label).toBe("verify-window");
    expect(list.waitingOnCounts.some((c) => c.label === "trial-period")).toBe(
      true,
    );
    expect(list.timeline.some((e) => e.kind === "wake")).toBe(true);
    expect(list.timeline.every((e) => e.at >= now && e.at < now + 86_400_000)).toBe(
      true,
    );
  });

  test("DST ambiguity surfaces only when attached on the row", async () => {
    const runtime = createManifestClockRuntime(manifest, {
      now: () => Date.UTC(2024, 2, 1),
    });
    await runtime.reconcile();
    const nightly = await runtime.store.get("nightly");
    // Runtime reconcile may attach dstAmbiguity for America/New_York 02:00.
    const list = await projectClocksList({
      manifest,
      runtime,
      now: () => Date.UTC(2024, 2, 1),
    });
    const row = list.crons.find((c) => c.name === "nightly");
    if (nightly?.dstAmbiguity) {
      expect(row?.dstAmbiguity?.kind).toBeDefined();
    } else {
      expect(row?.dstAmbiguity ?? null).toBeNull();
    }
  });
});

describe("clock actions", () => {
  test("pause and editSchedule (overridable only)", async () => {
    const runtime = createManifestClockRuntime(manifest, {
      now: () => 0,
    });
    await runtime.reconcile();
    const paused = await pauseCronNow(runtime, "expire-holds");
    expect(paused.status).toBe("paused");

    const edited = await editCronSchedule(runtime, {
      name: "expire-holds",
      every: "5m",
    });
    expect(edited.effectiveEvery).toBe("5m");

    await expect(
      editCronSchedule(runtime, { name: "nightly", cron: "0 3 * * *" }),
    ).rejects.toBeInstanceOf(ScheduleNotOverridableError);
  });

  test("wakeEarly advances journal wakeAt", async () => {
    const now = 10_000;
    const journal = createMemoryJournalStore([
      {
        id: "run_sleep",
        flow: "x",
        input: {},
        status: "sleeping",
        entries: [
          {
            kind: "sleep",
            label: "grace",
            duration: "1h",
            wakeAt: now + 3_600_000,
            at: now,
          },
        ],
        wakeAt: now + 3_600_000,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const result = await wakeEarlyNow(journal, "run_sleep", {
      now: () => now,
    });
    expect(result.wakeAt).toBe(now);
    expect(result.resumed).toBe(false);
    const run = await journal.get("run_sleep");
    expect(run?.wakeAt).toBe(now);
  });
});

describe("projectWaitingOn", () => {
  test("extracts label, step, wake-in", () => {
    const now = 1000;
    const rows = projectWaitingOn(
      [
        {
          id: "r1",
          flow: "f",
          input: {},
          status: "sleeping",
          entries: [
            { kind: "step", name: "charge", value: true, at: 500 },
            {
              kind: "sleep",
              label: "grace",
              duration: "1m",
              wakeAt: 2000,
              at: 900,
            },
          ],
          wakeAt: 2000,
          createdAt: 0,
          updatedAt: 900,
        },
      ],
      now,
    );
    expect(rows).toEqual([
      {
        runId: "r1",
        flow: "f",
        label: "grace",
        wakeAt: 2000,
        wakeInMs: 1000,
        step: "charge",
      },
    ]);
  });
});
